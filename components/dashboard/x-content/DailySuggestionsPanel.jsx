'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, Save, X } from 'lucide-react';
import { Skeleton, RetryError } from './Feedback.jsx';
import { slotLabel, timingLine, strategySourceLine, slotStatuses, VOICE_LINE } from '../../../features/x-content-inventory/daily-loop/present.js';

// DailySuggestionsPanel — which X conversations to join today, with what owned
// content (Daily Content Loop POC, docs/plans/DAILY-CONTENT-LOOP-MASTER-PLAN.md).
//
// Review only. Generate reads SAVED inputs (scan, search, library, Brain,
// strategy, corpora) — the X search itself runs locally via
// `scripts/x-content/daily-run.mjs --discover`. Save Draft writes ONE
// unscheduled social_posts draft per suggestion; nothing here schedules or posts.
//
// STYLING: classNames only (`xce-dl-`); the parent card owns the single
// `<style jsx global>` block, prefixed `#x-content-card`.

const TYPE_LABEL = { reply: 'Reply', quote: 'Quote', original: 'Original post' };
const WHY_ROWS = [
  ['now', 'Why now'],
  ['brand', 'Why it fits'],
  ['brain', 'Brain'],
  ['strategy', 'Strategy'],
  ['content', 'Your content'],
];

function historyLine(h) {
  if (!h?.available) return h?.note || 'No own-account history loaded.';
  const t = h.type ? `${h.type.key}: n=${h.type.n}, ${h.type.lift == null ? 'no lift' : `${h.type.lift}× your average`}${h.type.weak ? ' (weak)' : ''}` : '';
  const topics = (h.topics || []).map((x) => `${x.topic}: n=${x.n}${x.lift == null ? '' : `, ${x.lift}×`}${x.weak ? ' (weak)' : ''}`).join(' · ');
  const range = h.range ? ` [${String(h.range.from).slice(0, 10)} → ${String(h.range.to).slice(0, 10)}]` : '';
  return [t, topics || 'no topic evidence', h.note].filter(Boolean).join(' — ') + range;
}

const STATUS_WORDS = {
  loaded: 'loaded',
  approved: 'approved',
  missing: 'missing — not used',
  excluded: 'excluded — not used',
  draft: 'draft, not approved — not used',
  stale: 'stale',
  unapproved: 'not approved — not used',
};
const COLLAPSED_GAPS = 3;
const TOGGLE = { alignSelf: 'flex-start', padding: 0, border: 0, background: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(42,36,32,0.7)', textDecoration: 'underline' };

function SuggestionCard({ s, text, thumbUrl, onText, onCommit, onSave, onDismiss, busy }) {
  const reviewed = s.reviewState === 'saved' || s.reviewState === 'dismissed';
  const stored = s.edit?.text ?? s.draft.text;
  const dirty = text !== stored;
  const checks = s.edit?.checks || s.checks;
  const empty = !text.trim();
  const max = s.type === 'quote' ? 90 : s.type === 'reply' ? 200 : 280;
  return (
    <article id={`daily-suggestion-card-${s.id}`} data-suggestion-id={s.id} className={`xce-dl-card${checks.blocked ? ' xce-dl-blocked' : ''}`}>
      <header id={`daily-suggestion-header-row-${s.id}`} className="xce-dl-card-head">
        <span className={`xce-dl-type xce-dl-type-${s.type}`}>{TYPE_LABEL[s.type] || s.type}</span>
        {s.match?.tier === 'genre' ? <span className="xce-dl-tier">genre-level match</span> : null}
        {slotLabel(s.slot) ? <span id={`daily-suggestion-slot-label-${s.id}`} className="xce-dl-slot-label" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: '#2a2420' }}>{slotLabel(s.slot)}</span> : null}
        <span className="xce-dl-slot">{timingLine(s)}</span>
      </header>

      {s.conversation ? (
        <div id={`daily-suggestion-conversation-${s.id}`} className="xce-dl-convo">
          {s.conversation.posts.slice(0, 3).map((p) => (
            <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="xce-dl-post">
              <span className="xce-dl-post-meta">@{p.author} · {p.ageHours}h old · {p.likes}♥ {p.replies}↩ <ExternalLink size={11} /></span>
              <span className="xce-dl-post-text">{p.text}</span>
            </a>
          ))}
        </div>
      ) : null}

      <dl id={`daily-suggestion-why-${s.id}`} className="xce-dl-why">
        {WHY_ROWS.map(([k, label]) => (
          <React.Fragment key={k}><dt>{label}</dt><dd>{s.why[k]}</dd></React.Fragment>
        ))}
        <dt>Your history</dt><dd>{historyLine(s.why.history)}</dd>
      </dl>

      <div id={`daily-suggestion-content-${s.id}`} className="xce-dl-content">
        {thumbUrl ? <img id={`daily-suggestion-thumb-${s.id}`} src={thumbUrl} alt="" loading="lazy" style={{ display: 'block', maxWidth: 120, maxHeight: 120, marginBottom: 6, borderRadius: 8, objectFit: 'cover' }} /> : null}
        {s.package ? (
          <>
            <strong>{s.package.title}</strong>
            <ul>
              {s.package.basis === 'story' ? <li>your own story on file</li> : null}
              {(s.package.facts || []).slice(0, 5).map((f) => (
                <li key={`${f.label}-${f.value}`}>{f.label}: {f.label === 'source' ? <a href={f.value} target="_blank" rel="noreferrer">{f.value}</a> : f.value} <em>({f.provenance})</em></li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <strong>no owned item: reaction slot</strong>
            {s.related ? <p id={`daily-suggestion-related-${s.id}`}>related: {s.related.title || s.related.id}</p> : null}
          </>
        )}
      </div>

      <span className="xce-dl-draft-label">
        Draft <span>({s.edit ? 'your edit' : s.draft.source})</span>
      </span>
      <textarea
        id={`daily-suggestion-edit-textarea-${s.id}`}
        aria-label="Draft text"
        placeholder={empty ? 'write this one yourself' : undefined}
        className="xce-dl-textarea"
        value={text}
        onChange={(e) => onText(e.target.value)}
        onBlur={() => { if (dirty) onCommit(); }}
        disabled={reviewed || busy}
        rows={3}
      />
      <div id={`daily-suggestion-checks-row-${s.id}`} className="xce-dl-checks">
        <span className={text.length > max ? 'xce-dl-bad' : ''}>{text.length}/{max}</span>
        {empty ? <span id={`daily-suggestion-write-yourself-${s.id}`} className="xce-dl-muted">write this one yourself</span> : null}
        {dirty ? <span>click outside the box to re-check before saving</span> : (
          <>
            <span className={checks.blocked ? 'xce-dl-bad' : 'xce-dl-ok'}>{checks.blocked ? 'blocked' : 'checks pass'}</span>
            <span>guard lane: {checks.guard.lane}</span>
            <span>{checks.score ? `score ${Number(checks.score.value).toFixed(2)} (advisory)` : 'score n/a for quotes'}</span>
          </>
        )}
        {s.type === 'quote' ? <span>quote URL is appended on save</span> : null}
        {s.type === 'reply' ? <span>saved with its reply target</span> : null}
      </div>
      {!dirty && (checks.violations.length || checks.warnings.length) ? (
        <ul id={`daily-suggestion-violations-list-${s.id}`} style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.4, overflowWrap: 'anywhere' }}>
          {checks.violations.map((v) => <li key={`v-${v}`} className="xce-dl-bad">{v}</li>)}
          {checks.warnings.map((w) => <li key={`w-${w}`} className="xce-dl-muted">warning: {w}</li>)}
        </ul>
      ) : null}

      <div id={`daily-suggestion-actions-row-${s.id}`} className="xce-dl-actions">
        {s.reviewState === 'saved' ? (
          <span id={`daily-suggestion-saved-note-${s.id}`} className="xce-dl-ok">Saved as draft · post {s.socialPostId}</span>
        ) : s.reviewState === 'dismissed' ? (
          <span className="xce-dl-muted">Dismissed</span>
        ) : (
          <>
            <button type="button" className="xce-btn-primary" disabled={busy || dirty || empty || checks.blocked} onClick={onSave}>
              <Save size={13} /> {busy ? 'Working…' : 'Save draft'}
            </button>
            <button type="button" className="xce-btn-ghost" disabled={busy} onClick={onDismiss}>
              <X size={13} /> Dismiss
            </button>
          </>
        )}
      </div>
    </article>
  );
}

// Stack the three-column input rows below 640px (the parent's 481px breakpoint
// squeezed the detail column to ~60px at 500px). Scoped by id, so it only
// touches this panel.
const INPUTS_STACK_CSS = '@media (max-width: 640px) { #x-content-card #daily-run-inputs-panel .xce-dl-input { grid-template-columns: 1fr; } }';

function StrategySource({ run }) {
  const src = run.strategySource;
  const line = strategySourceLine(src);
  const slots = slotStatuses(run);
  return (
    <div id="daily-run-strategy-source" className="xce-dl-input">
      <span>strategy source</span>
      <span>{line || 'no slot plan for this run'}</span>
      <span>
        {src && slots.length ? slots.map((x) => `${x.letter} ${x.timeCT || 'anytime'} ${x.type}`).join(' · ') : null}
        {src && slots.length ? <br /> : null}
        {VOICE_LINE}
      </span>
    </div>
  );
}

function InputsPanel({ run }) {
  // run.js already emits a 'strategy slots' row; the dedicated block above replaces it.
  const rows = (run.inputs || []).filter((i) => !(run.strategySource && i.input === 'strategy slots'));
  return (
    <div id="daily-run-inputs-panel" className="xce-dl-inputs">
      <style>{INPUTS_STACK_CSS}</style>
      <StrategySource run={run} />
      {rows.map((i) => (
        <div key={i.input} className={`xce-dl-input xce-dl-input-${String(i.status).replace(/\s+/g, '-')}`}>
          <span>{i.input}</span>
          <span>{STATUS_WORDS[i.status] || i.status}{i.age ? ` · ${i.age}` : ''}</span>
          <span>{i.detail}</span>
        </div>
      ))}
    </div>
  );
}

function GapsList({ gaps }) {
  const [open, setOpen] = useState(false);
  const ordered = [...gaps.filter((g) => g.slot), ...gaps.filter((g) => !g.slot)];
  const shown = open ? ordered : ordered.slice(0, COLLAPSED_GAPS);
  return (
    <div id="daily-run-gaps-list" className="xce-dl-gaps">
      <span className="xce-kicker">Gaps and missing inputs</span>
      <ul>
        {shown.map((g) => (
          <li key={g.code}>
            {g.slot ? <><strong>Slot {g.slot.letter}</strong> ({[g.slot.timeCT ? `${g.slot.timeCT} CT` : 'anytime', g.slot.type, g.slot.pillar].filter(Boolean).join(' · ')}) unfilled: {g.slot.fillReason || g.message}</> : <><code>{g.code}</code> {g.message}</>}
          </li>
        ))}
      </ul>
      {gaps.length > COLLAPSED_GAPS ? (
        <button type="button" style={TOGGLE} onClick={() => setOpen((o) => !o)}>{open ? 'show fewer' : `show all ${gaps.length}`}</button>
      ) : null}
    </div>
  );
}

function Shortlist({ run }) {
  const [open, setOpen] = useState(false);
  const used = new Set(run.suggestions.map((s) => s.conversation?.id).filter(Boolean));
  const skipped = (run.shortlist || []).filter((c) => !used.has(c.id));
  const reasons = run.gaps.filter((g) => /skipped|no-content|off-brand/.test(`${g.code} ${g.message}`));
  if (!skipped.length && !reasons.length) return null;
  return (
    <div id="daily-run-shortlist" className="xce-dl-gaps">
      <button type="button" style={TOGGLE} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide' : 'Show'} conversations considered but not suggested ({skipped.length})
      </button>
      {open ? (
        <>
          <ul>
            {skipped.map((c) => (
              <li key={c.id}>
                <a href={c.anchor} target="_blank" rel="noreferrer">{c.label}</a> — brand fit {c.brandFit}, {c.skipped ? `skipped: ${c.reason}` : <>best content <code>{c.content}</code>; ranked below the picks</>}
              </li>
            ))}
          </ul>
          {reasons.length ? <ul>{reasons.map((g) => <li key={g.code}>{g.message}</li>)}</ul> : null}
        </>
      ) : null}
    </div>
  );
}

export default function DailySuggestionsPanel({ call, showToast }) {
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [withModel, setWithModel] = useState(false);
  const [texts, setTexts] = useState({});
  const [thumbs, setThumbs] = useState({});
  const [showDismissed, setShowDismissed] = useState(false);

  const adopt = useCallback((next) => {
    setRun(next || null);
    setTexts(Object.fromEntries((next?.suggestions || []).map((s) => [s.id, s.savedText || s.edit?.text || s.draft.text])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { adopt((await call('daily-run-latest')).run); } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, [call, adopt]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ids = [...new Set((run?.suggestions || []).filter((s) => s.package?.thumbRef).map((s) => s.package.id))];
    if (!ids.length) return undefined;
    let live = true;
    call('media-urls', { ids, kinds: ['thumb'] })
      .then((r) => { if (live) setThumbs(Object.fromEntries(ids.map((id) => [id, r?.urls?.[id]?.thumbUrl || null]))); })
      .catch(() => {});
    return () => { live = false; };
  }, [run, call]);

  const generate = useCallback(async (force) => {
    setBusy('generate');
    setError('');
    try {
      const res = await call('daily-run-generate', { force, draftWithModel: withModel });
      adopt(res.run);
      showToast?.(res.skipped ? `Inputs unchanged (${res.reason}) — showing the saved run.` : 'Suggestions generated.');
    } catch (err) { setError(err.message); } finally { setBusy(null); }
  }, [call, adopt, withModel, showToast]);

  const commitEdit = useCallback(async (s) => {
    setBusy(s.id);
    try { adopt((await call('daily-run-edit', { suggestionId: s.id, text: texts[s.id] })).run); } catch (err) { showToast?.(err.message, 'error'); } finally { setBusy(null); }
  }, [call, adopt, texts, showToast]);

  const save = useCallback(async (s) => {
    setBusy(s.id);
    try {
      const res = await call('daily-run-save-draft', { suggestionId: s.id, text: texts[s.id] });
      adopt(res.run);
      showToast?.(res.existing ? 'Already saved — no duplicate created.' : 'Saved to the queue as an unscheduled draft.');
    } catch (err) { showToast?.(err.message, 'error'); } finally { setBusy(null); }
  }, [call, adopt, texts, showToast]);

  const dismiss = useCallback(async (s) => {
    setBusy(s.id);
    try { adopt((await call('daily-run-dismiss', { suggestionId: s.id })).run); } catch (err) { showToast?.(err.message, 'error'); } finally { setBusy(null); }
  }, [call, adopt, showToast]);

  const dismissedCount = (run?.suggestions || []).filter((s) => s.reviewState === 'dismissed').length;
  const visible = (run?.suggestions || []).filter((s) => showDismissed || s.reviewState !== 'dismissed');

  return (
    <section id="daily-suggestions-panel" className="xce-panel">
      <div id="daily-suggestions-header" className="xce-head">
        <span className="xce-kicker">Conversations to join{run ? ` · ${run.localDate}` : ''}</span>
        <div id="daily-run-generate-controls" className="xce-dl-controls">
          <label className="xce-dl-model">
            <input type="checkbox" checked={withModel} onChange={(e) => setWithModel(e.target.checked)} disabled={!!busy} />
            Use model copy (paid, ≤3 calls)
          </label>
          <button type="button" className="xce-refresh" disabled={!!busy} onClick={() => generate(false)}>
            <RefreshCw size={12} /> {run ? 'Refresh' : 'Generate'}
          </button>
          {run ? <button type="button" className="xce-refresh" disabled={!!busy} onClick={() => generate(true)}>Regenerate</button> : null}
        </div>
      </div>
      <p id="daily-run-intro-note" className="xce-sub">Reads saved inputs only. X search runs locally: <code>node scripts/x-content/daily-run.mjs --client &lt;id&gt; --discover --write</code>. Nothing is scheduled or posted.</p>

      {loading ? <Skeleton id="daily-suggestions-loading" rows={3} /> : null}
      {error ? <RetryError id="daily-suggestions-error" message={error} onRetry={load} busy={loading} /> : null}
      {!loading && !error && !run ? <div className="xce-empty">No run today yet. Generate one to see conversations worth joining.</div> : null}

      {run ? (
        <>
          <InputsPanel run={run} />
          <GapsList gaps={run.gaps || []} />

          <div id="daily-suggestions-list" className="xce-dl-list">
            {visible.length ? visible.map((s) => (
              <SuggestionCard
                key={s.id}
                s={s}
                text={texts[s.id] ?? s.edit?.text ?? s.draft.text}
                thumbUrl={thumbs[s.package?.id] || null}
                onText={(v) => setTexts((t) => ({ ...t, [s.id]: v }))}
                onCommit={() => commitEdit(s)}
                onSave={() => save(s)}
                onDismiss={() => dismiss(s)}
                busy={busy === s.id || busy === 'generate'}
              />
            )) : <div className="xce-empty">No suggestion today — see the gaps above.</div>}
          </div>
          {dismissedCount ? (
            <button id="daily-run-show-dismissed-toggle" type="button" style={TOGGLE} onClick={() => setShowDismissed((v) => !v)}>
              {showDismissed ? 'hide dismissed' : `show dismissed (${dismissedCount})`}
            </button>
          ) : null}

          <Shortlist run={run} />
          <p id="daily-run-stats-line" className="xce-sub">{run.stats.conversationPosts} posts → {run.stats.narratives} conversations → {run.stats.onBrandWithContent} on-brand with owned content · library {run.stats.eligible}/{run.stats.packages} eligible · {run.usage.modelCalls} model call(s) · inputs: {run.inputSource || run.mode}</p>
        </>
      ) : null}
    </section>
  );
}
