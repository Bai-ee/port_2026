'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, Save, X } from 'lucide-react';
import { Skeleton, RetryError } from './Feedback.jsx';

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

function SuggestionCard({ s, text, onText, onSave, onDismiss, busy }) {
  const edited = text !== s.draft.text;
  const reviewed = s.reviewState === 'saved' || s.reviewState === 'dismissed';
  const max = s.type === 'quote' ? 90 : s.type === 'reply' ? 200 : 280;
  return (
    <article id={`daily-suggestion-${s.id}`} className={`xce-dl-card${s.checks.blocked ? ' xce-dl-blocked' : ''}`}>
      <header className="xce-dl-card-head">
        <span className={`xce-dl-type xce-dl-type-${s.type}`}>{TYPE_LABEL[s.type] || s.type}</span>
        {s.match?.tier === 'genre' ? <span className="xce-dl-tier">genre-level match</span> : null}
        <span className="xce-dl-slot">suggested {s.proposedSlot.localTime} CT · not scheduled</span>
      </header>

      {s.conversation ? (
        <div id={`daily-suggestion-${s.id}-conversation`} className="xce-dl-convo">
          {s.conversation.posts.slice(0, 3).map((p) => (
            <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="xce-dl-post">
              <span className="xce-dl-post-meta">@{p.author} · {p.ageHours}h · {p.likes}♥ {p.replies}↩ <ExternalLink size={11} /></span>
              <span className="xce-dl-post-text">{p.text}</span>
            </a>
          ))}
        </div>
      ) : null}

      <dl id={`daily-suggestion-${s.id}-why`} className="xce-dl-why">
        {WHY_ROWS.map(([k, label]) => (
          <React.Fragment key={k}><dt>{label}</dt><dd>{s.why[k]}</dd></React.Fragment>
        ))}
        <dt>Your history</dt><dd>{historyLine(s.why.history)}</dd>
      </dl>

      <div id={`daily-suggestion-${s.id}-content`} className="xce-dl-content">
        <strong>{s.package.title}</strong>
        <ul>
          {s.package.basis === 'story' ? <li>your own story on file</li> : null}
          {(s.package.facts || []).slice(0, 5).map((f) => (
            <li key={`${f.label}-${f.value}`}>{f.label}: {f.label === 'source' ? <a href={f.value} target="_blank" rel="noreferrer">{f.value}</a> : f.value} <em>({f.provenance})</em></li>
          ))}
        </ul>
      </div>

      <label className="xce-dl-draft-label" htmlFor={`daily-suggestion-${s.id}-text`}>
        Draft <span>({s.draft.source})</span>
      </label>
      <textarea
        id={`daily-suggestion-${s.id}-text`}
        className="xce-dl-textarea"
        value={text}
        onChange={(e) => onText(e.target.value)}
        disabled={reviewed || busy}
        rows={3}
      />
      <div id={`daily-suggestion-${s.id}-checks`} className="xce-dl-checks">
        <span className={text.length > max ? 'xce-dl-bad' : ''}>{text.length}/{max}</span>
        {edited ? <span>edited — re-checked on save</span> : (
          <>
            <span className={s.checks.blocked ? 'xce-dl-bad' : 'xce-dl-ok'}>{s.checks.blocked ? `blocked: ${s.checks.violations.join('; ')}` : 'checks pass'}</span>
            <span>guard lane: {s.checks.guard.lane}</span>
            <span>{s.checks.score ? `score ${Number(s.checks.score.value).toFixed(2)} (advisory)` : 'score n/a for quotes'}</span>
          </>
        )}
        {s.type === 'quote' ? <span>quote URL is appended on save</span> : null}
        {s.type === 'reply' ? <span>saved with its reply target</span> : null}
      </div>

      <div className="xce-dl-actions">
        {s.reviewState === 'saved' ? (
          <span id={`daily-suggestion-${s.id}-saved`} className="xce-dl-ok">Saved as draft · {s.socialPostId}</span>
        ) : s.reviewState === 'dismissed' ? (
          <span className="xce-dl-muted">Dismissed</span>
        ) : (
          <>
            <button type="button" className="xce-btn-primary" disabled={busy || (!edited && s.checks.blocked)} onClick={onSave}>
              <Save size={13} /> Save draft
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

export default function DailySuggestionsPanel({ call, showToast }) {
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [withModel, setWithModel] = useState(false);
  const [texts, setTexts] = useState({});

  const adopt = useCallback((next) => {
    setRun(next || null);
    setTexts(Object.fromEntries((next?.suggestions || []).map((s) => [s.id, s.savedText || s.draft.text])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { adopt((await call('daily-run-latest')).run); } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, [call, adopt]);

  useEffect(() => { load(); }, [load]);

  const generate = useCallback(async (force) => {
    setBusy('generate');
    setError('');
    try {
      const res = await call('daily-run-generate', { force, draftWithModel: withModel });
      adopt(res.run);
      showToast?.(res.skipped ? `Inputs unchanged (${res.reason}) — showing the saved run.` : 'Suggestions generated.');
    } catch (err) { setError(err.message); } finally { setBusy(null); }
  }, [call, adopt, withModel, showToast]);

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

  return (
    <section id="daily-suggestions-panel" className="xce-panel">
      <div id="daily-suggestions-header" className="xce-head">
        <span className="xce-kicker">Conversations to join{run ? ` · ${run.localDate}` : ''}</span>
        <div className="xce-dl-controls">
          <label className="xce-dl-model">
            <input type="checkbox" checked={withModel} onChange={(e) => setWithModel(e.target.checked)} disabled={!!busy} />
            draft with model (paid, ≤3 calls)
          </label>
          <button type="button" className="xce-refresh" disabled={!!busy} onClick={() => generate(false)}>
            <RefreshCw size={12} /> {run ? 'Refresh' : 'Generate'}
          </button>
          {run ? <button type="button" className="xce-refresh" disabled={!!busy} onClick={() => generate(true)}>Regenerate</button> : null}
        </div>
      </div>
      <p className="xce-sub">Reads saved inputs only. X search runs locally: <code>node scripts/x-content/daily-run.mjs --client &lt;id&gt; --discover --write</code>. Nothing is scheduled or posted.</p>

      {loading ? <Skeleton id="daily-suggestions-loading" rows={3} /> : null}
      {error ? <RetryError id="daily-suggestions-error" message={error} onRetry={load} busy={loading} /> : null}
      {!loading && !error && !run ? <div className="xce-empty">No run today yet. Generate one to see conversations worth joining.</div> : null}

      {run ? (
        <>
          <div id="daily-run-inputs-panel" className="xce-dl-inputs">
            {(run.inputs || []).map((i) => (
              <div key={i.input} className={`xce-dl-input xce-dl-input-${String(i.status).replace(/\s+/g, '-')}`}>
                <span>{i.input}</span><span>{i.status}{i.age ? ` · ${i.age}` : ''}</span><span>{i.detail}</span>
              </div>
            ))}
          </div>

          <div id="daily-suggestions-list" className="xce-dl-list">
            {run.suggestions.length ? run.suggestions.map((s) => (
              <SuggestionCard
                key={s.id}
                s={s}
                text={texts[s.id] ?? s.draft.text}
                onText={(v) => setTexts((t) => ({ ...t, [s.id]: v }))}
                onSave={() => save(s)}
                onDismiss={() => dismiss(s)}
                busy={busy === s.id || busy === 'generate'}
              />
            )) : <div className="xce-empty">No suggestion today — see the gaps below.</div>}
          </div>

          <div id="daily-run-gaps-panel" className="xce-dl-gaps">
            <span className="xce-kicker">Gaps and missing inputs</span>
            <ul>{run.gaps.map((g) => <li key={g.code}><code>{g.code}</code> {g.message}</li>)}</ul>
            <p className="xce-sub">{run.stats.conversationPosts} posts → {run.stats.narratives} conversations → {run.stats.onBrandWithContent} on-brand with owned content · library {run.stats.eligible}/{run.stats.packages} eligible · {run.usage.modelCalls} model call(s)</p>
          </div>
        </>
      ) : null}
    </section>
  );
}
