'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ArrowUpRight, BookOpen, Check, FileText, Plus, Shield, Sparkles } from 'lucide-react';
import {
  memorySuggestModel,
  proposalKindLabel, proposalPayloadPreview, proposalStatusText, chatErrorText, costFooterText, plainChatText,
  historyDiffSummary,
} from '../../../features/x-strategy/ui-model.js';
import { describeDocChange, sectionTitle } from '../../../features/x-strategy/strategy-doc.js';
import { XCE_COLORS, XCE_RADII } from '../content-ui/xce-tokens';
import Accordion from '../content-ui/ui/Accordion';
import Badge from '../content-ui/ui/Badge';
import IconButton from '../content-ui/ui/IconButton';
import SectionLabel from '../content-ui/ui/SectionLabel';
import MiniThumb from './MiniThumb.jsx';
import ActionProposalCard from './ActionProposalCard.jsx';
import UndoChip from './UndoChip.jsx';
import AgentPermissionsPanel from './AgentPermissionsPanel.jsx';
import { messageUndoChips } from '../../../features/x-strategy/action-ui-model.js';
import MemorySuggestRows from './MemorySuggestRows.jsx';

// StrategyChat - the agent chat in the Strategy tab's right column.
//
//   <StrategyChat clientId call onPlanChanged onRefreshed currentPlan?
//                 planVersion? history? prefill? onViewPlan? onViewChange? onUndo? undoNote? selected? />
//
// `selected` = {kind:'suggestion'|'post'|'opportunity', id} (optional): sent with each message so the agent knows
// which item the owner means. The server re-resolves it for this client; chat itself never approves/schedules.
//
// Presentation props (all optional, owned by StrategyPanel): `history` = plan history (oldest first), used only
// to interleave manual-edit rows into the timeline; `prefill` = {text, nonce} fills the composer WITHOUT
// sending; `onViewPlan` / `onViewChange(version)` switch the Details pane; `onUndo(version)` = the panel's
// existing strategy-plan-revert to the prior version; `undoNote` = {version, busy, text, kind} feedback.
//
// Strategy document props (optional, owned by StrategyPanel): `docHistory` = doc history (oldest first), manual
// entries are interleaved like plan edits; `docSections` = current section text (shown on a doc-edit card);
// `reviewRequest` = {nonce} runs a strategy review (strategy-review) in the current thread; `onReviewed` /
// `onDocChanged` let the panel re-read the doc; `onViewDoc` opens the Strategy sub-tab.
//
// `call(action, body)` is the card's quote-targets POST helper (throws errors with .status / .data).
// One request per turn (non-streaming). The agent only PROPOSES; nothing runs until the owner presses
// Confirm on a card. The active threadId lives in component state only; strategy-chat-history restores the
// latest thread on mount.

const INPUT_MAX = 2000;

const S = {
  h: { margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: XCE_COLORS.inkSoft },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 },
  list: { display: 'grid', gap: 12, minWidth: 0, overflowY: 'auto', padding: '2px 2px 8px', alignContent: 'start' },
  userBubble: { justifySelf: 'end', maxWidth: '88%', padding: '9px 13px', borderRadius: 16, background: XCE_COLORS.ink, color: XCE_COLORS.onInk, fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  botBubble: { justifySelf: 'start', maxWidth: '100%', padding: '9px 13px', borderRadius: 16, background: XCE_COLORS.surfaceMuted, border: `1px solid ${XCE_COLORS.border}`, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  time: { margin: '3px 4px 0', fontSize: 11, color: XCE_COLORS.inkMuted },
  cardsCol: { display: 'grid', gap: 8, marginTop: 8, minWidth: 0 },
  card: { padding: '12px 14px', borderRadius: XCE_RADII.md + 2, background: XCE_COLORS.surface, border: `1px solid ${XCE_COLORS.border}`, display: 'grid', gap: 8, minWidth: 0 },
  cardHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  kind: { fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: XCE_COLORS.inkSoft },
  summary: { fontSize: 14, fontWeight: 600, lineHeight: 1.4, overflowWrap: 'anywhere' },
  rationale: { margin: 0, fontSize: 12.5, lineHeight: 1.45, color: XCE_COLORS.inkSoft, overflowWrap: 'anywhere' },
  small: { margin: 0, paddingLeft: 16, fontSize: 12.5, lineHeight: 1.45, overflowWrap: 'anywhere' },
  preview: { margin: 0, padding: '6px 8px', borderRadius: 8, background: XCE_COLORS.greyBg, listStyle: 'none', fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.5, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' },
  label: { fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: XCE_COLORS.inkMuted },
  row: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  err: { margin: '8px 0 0', fontSize: 12, lineHeight: 1.4, color: XCE_COLORS.red },
  note: { margin: '6px 0 0', fontSize: 12, lineHeight: 1.45, color: XCE_COLORS.inkSoft },
  ok: { margin: 0, fontSize: 12, lineHeight: 1.4, color: XCE_COLORS.green },
  textLink: { display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 36, padding: '0 4px', border: 0, background: 'transparent', color: XCE_COLORS.ink, fontSize: 13, textDecoration: 'underline', cursor: 'pointer' },
  checkDisc: { flex: '0 0 auto', width: 32, height: 32, borderRadius: XCE_RADII.pill, background: XCE_COLORS.greenBg, color: XCE_COLORS.green, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  historyRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: XCE_RADII.md, border: `1px solid ${XCE_COLORS.border}`, background: XCE_COLORS.surface, fontSize: 12.5, color: XCE_COLORS.inkSoft, minWidth: 0 },
  composer: { display: 'grid', gap: 8, padding: 8, border: `1px solid ${XCE_COLORS.border}`, borderRadius: XCE_RADII.lg, background: XCE_COLORS.surface },
  input: { flex: '1 1 auto', minWidth: 0, boxSizing: 'border-box', minHeight: 44, maxHeight: 140, resize: 'none', padding: '10px 12px', borderRadius: XCE_RADII.md, border: `1px solid ${XCE_COLORS.border}`, background: XCE_COLORS.surface, color: XCE_COLORS.ink, font: 'inherit', fontSize: 16, lineHeight: 1.4 },
  promptChip: { minHeight: 36, padding: '0 14px', borderRadius: XCE_RADII.pill, border: `1px solid ${XCE_COLORS.border}`, background: XCE_COLORS.surface, color: XCE_COLORS.ink, fontSize: 13, cursor: 'pointer' },
};

// Layout only. Every selector is prefixed with the panel id. The composer is IN FLOW (not sticky): the card's
// phone bottom nav is itself sticky, so a sticky composer slid underneath it and overlapped the messages.
const CHAT_CSS = `
  #x-strategy-chat-panel { display: grid; gap: 0; min-width: 0; align-content: start; }
  #x-strategy-chat-messages { min-height: 200px; max-height: min(58vh, 560px); }
  #x-strategy-chat-composer { margin-top: 10px; }
  #x-strategy-chat-input-row { display: flex; align-items: flex-end; gap: 8px; }
  #x-strategy-chat-prompt-chips-row { display: flex; flex-wrap: wrap; gap: 8px; }
  @media (max-width: 480px) {
    #x-strategy-chat-messages { min-height: 160px; max-height: 46vh; }
    #x-strategy-chat-hint { display: none; }
  }
`;

const PROMPT_CHIPS = ['Help me shape my strategy', 'Compare me to my benchmarks', 'What does the algorithm reward?'];
const REVIEW_TEXT = 'Review my strategy against the latest data.';

const toMs = (at) => { const ms = Date.parse(at || ''); return Number.isFinite(ms) ? ms : null; };

/** "2:14 PM" in the viewer's locale, or '' when `at` is missing/invalid. */
export function formatClock(at) {
  const ms = toMs(at);
  return ms === null ? '' : new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "Today · 2:14 PM" / "Oct 10 · 2:14 PM", or '' when `at` is missing/invalid. */
export function formatDayTime(at) {
  const ms = toMs(at);
  if (ms === null) return '';
  const d = new Date(ms);
  const same = d.toDateString() === new Date().toDateString();
  return `${same ? 'Today' : d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${formatClock(at)}`;
}

const TONE_BY_STATUS = { pending: 'amber', ok: 'green', muted: 'grey', error: 'red' };

function ProposalCard({ call, proposal, currentPlan, history, planVersion, deciding, onDecide, useModel, onUseModel, memoryState, onMemoryState, onViewPlan, onUndo, undoNote, docSections, onViewDoc }) {
  const isDocEdit = proposal.kind === 'strategy-doc-edit';
  const id = proposal.id;
  // Cards made by an external assistant over MCP live in `t_mcp_<yyyymmdd>` threads (createProposalInThread).
  const fromMcp = typeof proposal.threadId === 'string' && proposal.threadId.startsWith('t_mcp_');
  const st = proposalStatusText(proposal);
  const evidence = Array.isArray(proposal.evidence) ? proposal.evidence : [];
  const pending = proposal.status === 'pending';
  const confirmed = proposal.status === 'confirmed';
  const isPlanChange = proposal.kind === 'plan-change';
  const savedVersion = confirmed && isPlanChange && Number.isFinite(proposal.result?.version) ? proposal.result.version : 0;
  // After a confirm, `currentPlan` already holds the NEW values, so a from -> to preview would read "3 -> 3".
  // The saved history entry carries the real diff, so use that instead.
  const savedEntry = savedVersion ? (history || []).find((h) => h.version === savedVersion) : null;
  const rawPreview = confirmed && isPlanChange ? [] : proposalPayloadPreview(proposal.kind, proposal.payload, currentPlan);
  // post-edit shows current vs new text in its own block (below); keep only the time/notes lines here.
  const isPostAction = ['post-approve', 'post-schedule', 'post-unschedule'].includes(proposal.kind);
  const preview = proposal.kind === 'post-edit' ? rawPreview.filter((l) => !/^(Current|New) text:/.test(l))
    : isPostAction ? rawPreview.filter((l) => !/^Post:/.test(l)) : rawPreview;
  const diffLine = savedEntry ? historyDiffSummary(savedEntry) : '';
  // Undo = restore the plan as it stood after the prior version. Only while this is still the newest version
  // (reverting an older change would silently discard later ones) and only when a prior version still exists.
  const canUndo = !!savedVersion && savedVersion >= 2 && planVersion === savedVersion && (history || []).some((h) => h.version === savedVersion - 1);
  const showWhy = !pending && (proposal.rationale || evidence.length);
  const whyBody = (
    <div id={`x-strategy-proposal-why-body-${id}`} style={{ display: 'grid', gap: 6 }}>
      {proposal.rationale ? <p id={`x-strategy-proposal-rationale-${id}`} style={S.rationale}>{proposal.rationale}</p> : null}
      {evidence.length ? (
        <div id={`x-strategy-proposal-evidence-${id}`}>
          <div style={S.label}>Evidence</div>
          <ul id={`x-strategy-proposal-evidence-list-${id}`} style={S.small}>
            {evidence.map((e, i) => <li key={i}><b>{e.source}</b>{e.figure ? `: ${e.figure}` : ''}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
  const badgeLabel = savedVersion ? `Saved · v${savedVersion}` : st.label;
  return (
    <div id={`x-strategy-proposal-${id}`} data-section="chat-proposal" style={S.card}>
      <div id={`x-strategy-proposal-body-row-${id}`} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0 }}>
        {confirmed ? <span id={`x-strategy-proposal-check-${id}`} style={S.checkDisc}><Check size={18} /></span> : null}
        <div id={`x-strategy-proposal-main-${id}`} style={{ display: 'grid', gap: 6, flex: 1, minWidth: 0 }}>
          <div id={`x-strategy-proposal-header-${id}`} style={S.cardHead}>
            <span style={S.kind}>{confirmed && isPlanChange ? 'Plan updated' : confirmed && isDocEdit ? 'Strategy updated' : proposalKindLabel(proposal.kind)}</span>
            {fromMcp ? <Badge id={`x-strategy-proposal-from-mcp-badge-${id}`} tone="blue">From MCP</Badge> : null}
            <Badge id={`x-strategy-proposal-status-${id}`} tone={TONE_BY_STATUS[st.tone] || 'grey'}>{badgeLabel}</Badge>
          </div>
          {proposal.summary ? <div id={`x-strategy-proposal-summary-${id}`} style={S.summary}>{proposal.summary}</div> : null}
          {diffLine ? <div id={`x-strategy-proposal-diff-${id}`} style={{ ...S.rationale, fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{diffLine}</div> : null}
          {pending && proposal.rationale ? <p id={`x-strategy-proposal-rationale-${id}`} style={S.rationale}>{proposal.rationale}</p> : null}
          {pending && evidence.length ? (
            <div id={`x-strategy-proposal-evidence-${id}`}>
              <div style={S.label}>Evidence</div>
              <ul id={`x-strategy-proposal-evidence-list-${id}`} style={S.small}>
                {evidence.map((e, i) => <li key={i}><b>{e.source}</b>{e.figure ? `: ${e.figure}` : ''}</li>)}
              </ul>
            </div>
          ) : null}
          {preview.length ? (
            <ul id={`x-strategy-proposal-preview-${id}`} style={S.preview}>
              {preview.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          ) : null}
          {pending && proposal.kind === 'memory-suggest' ? <MemorySuggestRows proposal={proposal} state={memoryState} disabled={deciding} onChange={(next) => onMemoryState(id, next)} /> : null}
          {proposal.kind === 'item-media' && Array.isArray(proposal.payload?.rows) ? (
            <ul id={`x-strategy-proposal-item-media-thumbs-${id}`} data-section="chat-proposal-item-media" style={{ ...S.small, listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
              {proposal.payload.rows.slice(0, 12).map((r) => (
                <li key={r.targetId} id={`x-strategy-proposal-item-media-row-${id}-${r.targetId}`} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <MiniThumb id={r.sourceId} call={call} kind={r.kind} size={36} label={r.sourceTitle || r.sourceId} />
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{r.targetTitle || r.targetId}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {proposal.kind === 'calendar-batch' && Array.isArray(proposal.payload?.preview?.sample) ? (
            <div id={`x-strategy-proposal-calendar-batch-thumbs-${id}`} data-section="chat-proposal-calendar-batch" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {proposal.payload.preview.sample.filter((r) => r.packageId).map((r) => (
                <MiniThumb key={r.packageId} id={r.packageId} call={call} nasSha={r.nasSha || null} size={44} label={`${r.reviewOn}: ${r.title}`} />
              ))}
            </div>
          ) : null}
          {proposal.kind === 'daily-fill' && Array.isArray(proposal.payload?.preview?.sample) && proposal.payload.preview.sample.some((r) => r.packageId) ? (
            <div id={`x-strategy-proposal-daily-fill-thumbs-${id}`} data-section="chat-proposal-daily-fill" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {proposal.payload.preview.sample.filter((r) => r.packageId).map((r) => (
                <MiniThumb key={`${r.date}-${r.packageId}`} id={r.packageId} call={call} nasSha={r.nasSha || null} size={44} label={`${r.date}: ${r.text}`} />
              ))}
            </div>
          ) : null}
          {st.detail ? (
            <p id={`x-strategy-proposal-result-${id}`} role="status" style={st.tone === 'error' ? { ...S.err, margin: 0 } : st.tone === 'ok' ? S.ok : S.note}>{st.detail}</p>
          ) : null}
          {isDocEdit && pending && docSections ? (
            <Accordion id={`x-strategy-proposal-current-text-${id}`} title={`Current ${sectionTitle(proposal.payload?.section)} text`}>
              <p style={{ ...S.rationale, whiteSpace: 'pre-wrap' }}>{docSections[proposal.payload?.section] || 'Empty.'}</p>
            </Accordion>
          ) : null}
          {isDocEdit && confirmed && typeof onViewDoc === 'function' ? (
            <div style={{ ...S.row, justifyContent: 'flex-end' }}>
              <button type="button" id={`x-strategy-proposal-view-doc-${id}`} style={S.textLink} onClick={onViewDoc}>View strategy <ArrowUpRight size={14} /></button>
            </div>
          ) : null}
          {isPostAction ? (
            <div id={`strategy-proposal-card-${proposal.kind}`} data-section="chat-proposal-post-action" style={{ display: 'grid', gap: 4 }}>
              <div style={S.label}>Post</div>
              <p id={`x-strategy-proposal-post-text-${id}`} style={{ ...S.rationale, whiteSpace: 'pre-wrap' }}>{(rawPreview.find((l) => /^Post:/.test(l)) || '').replace(/^Post:\s*/, '') || 'Not captured.'}</p>
            </div>
          ) : null}
          {proposal.kind === 'post-edit' && pending ? (
            <div id={`x-strategy-proposal-post-edit-compare-${id}`} style={{ display: 'grid', gap: 6 }}>
              <div id={`x-strategy-proposal-post-edit-current-${id}`}>
                <div style={S.label}>Current text{proposal.payload?.currentStatus ? ` (${proposal.payload.currentStatus})` : ''}</div>
                <p id={`x-strategy-proposal-post-edit-current-text-${id}`} style={{ ...S.rationale, whiteSpace: 'pre-wrap' }}>{proposal.payload?.currentText || 'Not captured.'}</p>
              </div>
              {proposal.payload?.text !== undefined ? (
                <div id={`x-strategy-proposal-post-edit-new-${id}`}>
                  <div style={S.label}>New text</div>
                  <p id={`x-strategy-proposal-post-edit-new-text-${id}`} style={{ ...S.rationale, whiteSpace: 'pre-wrap' }}>{proposal.payload.text}</p>
                </div>
              ) : null}
            </div>
          ) : null}
          {proposal.kind === 'item-story' && proposal.payload?.sourceQuote ? (
            <p id={`x-strategy-proposal-source-quote-${id}`} style={S.rationale}>Your words: {'“'}{proposal.payload.sourceQuote}{'”'}</p>
          ) : null}
        </div>
      </div>
      {pending && proposal.kind === 'regenerate-today' ? (
        <label id={`x-strategy-proposal-usemodel-row-${id}`} style={{ ...S.rationale, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" id={`x-strategy-proposal-usemodel-${id}`} checked={!!useModel} disabled={deciding} onChange={(e) => onUseModel(id, e.target.checked)} />
          Use the model to redraft {'—'} costs a few cents
        </label>
      ) : null}
      {pending ? (
        <div id={`x-strategy-proposal-actions-${id}`} style={S.row}>
          <button type="button" id={`x-strategy-proposal-confirm-${id}`} className="xce-btn" disabled={deciding} onClick={() => onDecide(proposal, 'confirm')}>
            {deciding ? 'Working…' : 'Confirm'}
          </button>
          <button type="button" id={`x-strategy-proposal-reject-${id}`} className="xce-btn xce-btn-ghost" disabled={deciding} onClick={() => onDecide(proposal, 'reject')}>
            Reject
          </button>
        </div>
      ) : null}
      {savedVersion ? (
        <div id={`x-strategy-proposal-saved-actions-${id}`} style={{ ...S.row, justifyContent: 'flex-end' }}>
          {canUndo && typeof onUndo === 'function' ? (
            <button type="button" id={`x-strategy-proposal-undo-${id}`} style={S.textLink} disabled={!!undoNote?.busy} onClick={() => onUndo(savedVersion)}>
              {undoNote?.busy && undoNote.version === savedVersion ? 'Undoing…' : 'Undo'}
            </button>
          ) : null}
          {typeof onViewPlan === 'function' ? (
            <button type="button" id={`x-strategy-proposal-view-plan-${id}`} style={S.textLink} onClick={onViewPlan}>
              View plan <ArrowUpRight size={14} />
            </button>
          ) : null}
        </div>
      ) : null}
      {savedVersion && undoNote?.version === savedVersion && undoNote.text && !undoNote.busy ? (
        <p id={`x-strategy-proposal-undo-note-${id}`} role={undoNote.kind === 'err' ? 'alert' : 'status'} style={undoNote.kind === 'err' ? { ...S.err, margin: 0 } : S.ok}>{undoNote.text}</p>
      ) : null}
      {showWhy ? <Accordion id={`x-strategy-proposal-why-${id}`} title="Why this change">{whyBody}</Accordion> : null}
    </div>
  );
}

export default function StrategyChat({
  clientId, call, onPlanChanged, onRefreshed, currentPlan, planVersion, history, prefill, onViewPlan, onViewChange, onUndo, undoNote, selected,
  docHistory, docSections, reviewRequest, onReviewed, onDocChanged, onViewDoc,
}) {
  const [threadId, setThreadId] = useState('');
  const [messages, setMessages] = useState([]);      // {role, text, proposalIds?}
  const [proposals, setProposals] = useState({});    // id -> proposal
  const [used, setUsed] = useState(undefined);
  const [cap, setCap] = useState(undefined);
  const [lastUsage, setLastUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [decidingId, setDecidingId] = useState('');
  const [decideErrors, setDecideErrors] = useState({}); // proposalId -> text
  const [useModelIds, setUseModelIds] = useState({});   // proposalId -> owner ticked 'use the model' (regenerate-today)
  const [showPermissions, setShowPermissions] = useState(false);
  const [memoryStates, setMemoryStates] = useState({});   // proposalId -> {edits, skip} (memory-suggest card, sent with decide)

  const mounted = useRef(true);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const clientIdRef = useRef(clientId);
  clientIdRef.current = clientId;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // Restore the latest thread.
  useEffect(() => {
    let cancelled = false;
    setThreadId(''); setMessages([]); setProposals({}); setLastUsage(null); setError(''); setDecideErrors({}); setUseModelIds({});
    if (!clientId || typeof call !== 'function') { setLoading(false); return undefined; }
    setLoading(true);
    (async () => {
      try {
        const res = await call('strategy-chat-history', { clientId });
        if (cancelled || !mounted.current) return;
        setUsed(res.turnsUsedToday); setCap(res.cap);
        const t = res.thread;
        if (t) {
          setThreadId(t.threadId || '');
          setMessages(Array.isArray(t.messages) ? t.messages : []);
          setProposals(t.proposals && typeof t.proposals === 'object' ? t.proposals : {});
          const lastBot = [...(t.messages || [])].reverse().find((m) => m.role === 'assistant' && m.usage);
          setLastUsage(lastBot?.usage ?? null);
        }
      } catch (err) {
        if (!cancelled && mounted.current) setError(chatErrorText(err));
      } finally {
        if (!cancelled && mounted.current) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, call]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, sending]);

  // Fill-only: an "Ask in chat" button in the Details pane drops text into the composer; the owner presses Send.
  useEffect(() => {
    if (!prefill?.nonce) return;
    setText(String(prefill.text || '').slice(0, INPUT_MAX));
    const el = inputRef.current;
    if (el) { el.focus({ preventScroll: true }); el.scrollIntoView?.({ block: 'nearest' }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce]);

  // Timeline = messages with the plan's MANUAL history entries interleaved by time. Entries made through chat are
  // already shown by their proposal card, and entries older than the thread are not part of this conversation.
  const timeline = useMemo(() => {
    const msgs = messages.map((m, n) => ({ kind: 'msg', m, n, ms: toMs(m.at) }));
    const firstMs = msgs.map((x) => x.ms).find((v) => v !== null);
    // Manual plan edits AND manual strategy-document edits, oldest first (chat-made changes show on their cards).
    const manualOf = (list, kind) => (firstMs === undefined ? [] : (Array.isArray(list) ? list : [])
      .filter((h) => (h.source || 'manual') === 'manual' && toMs(h.at) !== null && toMs(h.at) >= firstMs)
      .map((h) => ({ kind, h })));
    const manual = [...manualOf(history, 'plan'), ...manualOf(docHistory, 'doc')].sort((x, y) => toMs(x.h.at) - toMs(y.h.at));
    const out = [];
    let i = 0;
    const flush = (limit) => { while (i < manual.length && (limit === undefined || toMs(manual[i].h.at) <= limit)) { out.push(manual[i]); i += 1; } };
    for (const item of msgs) {
      if (item.ms === null) flush(); else flush(item.ms);
      out.push(item);
    }
    flush();
    return out;
  }, [messages, history, docHistory]);

  // One turn: a typed message (strategy-chat-send) or a strategy review (strategy-review, fixed brief server-side).
  const runTurn = useCallback(async ({ review = false } = {}) => {
    const body = review ? REVIEW_TEXT : text.trim();
    if (!body || sending || typeof call !== 'function') return;
    const startedFor = clientId; // a response for a client that is no longer shown must not touch state
    const sel = selected && typeof selected === 'object' && typeof selected.kind === 'string' && typeof selected.id === 'string' && selected.id ? { kind: selected.kind, id: selected.id } : null;
    setSending(true);
    setError('');
    setMessages((m) => [...m, { role: 'user', text: body, pending: true }]);
    if (!review) setText('');
    try {
      const res = review
        ? await call('strategy-review', { clientId, ...(threadId ? { threadId } : {}) })
        : await call('strategy-chat-send', { clientId, text: body, ...(threadId ? { threadId } : {}), ...(sel ? { selected: sel } : {}) });
      if (review && mounted.current && typeof onReviewed === 'function') onReviewed();
      if (!mounted.current || clientIdRef.current !== startedFor) return;
      const fresh = Array.isArray(res.proposals) ? res.proposals : [];
      setThreadId(res.threadId || threadId);
      setMessages((m) => [
        ...m.map((x) => (x.pending ? { role: x.role, text: x.text } : x)),
        { role: 'assistant', text: res.text || '', ...(fresh.length ? { proposalIds: fresh.map((p) => p.id) } : {}), ...(Array.isArray(res.toolResults) ? { toolResults: res.toolResults } : {}), ...(Array.isArray(res.undoIds) ? { undoIds: res.undoIds } : {}) },
      ]);
      if (fresh.length) setProposals((p) => ({ ...p, ...Object.fromEntries(fresh.map((x) => [x.id, x])) }));
      setUsed(res.turnsUsedToday); setCap(res.cap); setLastUsage(res.usage ?? null);
    } catch (err) {
      if (!mounted.current || clientIdRef.current !== startedFor) return;
      // The turn was not recorded: take the optimistic message back and restore the draft.
      setMessages((m) => m.filter((x) => !x.pending));
      if (!review) setText(body);
      setError(chatErrorText(err));
      const d = err?.data;
      if (d?.turnsUsedToday !== undefined) setUsed(d.turnsUsedToday);
      if (d?.cap !== undefined) setCap(d.cap);
      if (err?.status === 429 && d?.used !== undefined) setUsed(d.used);
    } finally {
      if (mounted.current) setSending(false); // always release the busy flag (it is not client-specific data)
    }
  }, [text, sending, call, clientId, threadId, selected, onReviewed]);
  const send = useCallback(() => runTurn(), [runTurn]);

  // The panel's "Review strategy" button: one review turn per nonce.
  const lastReviewNonce = useRef(0);
  useEffect(() => {
    if (!reviewRequest?.nonce || reviewRequest.nonce === lastReviewNonce.current || loading) return;
    lastReviewNonce.current = reviewRequest.nonce;
    runTurn({ review: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewRequest?.nonce, loading]);

  const decide = useCallback(async (proposal, decision, extra) => {
    if (decidingId || typeof call !== 'function') return;
    const startedFor = clientId;
    setDecidingId(proposal.id);
    setDecideErrors((e) => ({ ...e, [proposal.id]: '' }));
    try {
      const options = decision === 'confirm' && proposal.kind === 'regenerate-today' && useModelIds[proposal.id] ? { useModel: true } : undefined;
      const memory = decision === 'confirm' && proposal.kind === 'memory-suggest' ? memorySuggestModel(proposal, memoryStates[proposal.id]) : null;
      const res = await call('strategy-proposal-decide', { clientId, threadId: proposal.threadId || threadId, proposalId: proposal.id, decision, ...(options ? { options } : {}), ...(extra?.typed ? { typed: extra.typed } : {}), ...(memory ? { edits: memory.edits, skip: memory.skip } : {}) });
      if (!mounted.current || clientIdRef.current !== startedFor) return;
      const next = res.proposal || { ...proposal, status: decision === 'confirm' ? 'confirmed' : 'rejected' };
      setProposals((p) => ({ ...p, [proposal.id]: next }));
      if (next.status === 'confirmed') {
        if (next.kind === 'plan-change' && typeof onPlanChanged === 'function') onPlanChanged();
        if (next.kind === 'refresh-handles' && typeof onRefreshed === 'function') onRefreshed();
        if (next.kind === 'strategy-doc-edit' && typeof onDocChanged === 'function') onDocChanged();
        // The server ran nothing for a refresh: hand the groups to the dashboard's Refresh panel (one refresh system).
        if (next.kind === 'refresh' && next.result?.clientAction === 'marketing-refresh' && Array.isArray(next.result.groups) && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('hitloop:marketing-refresh', { detail: { ids: next.result.groups, todayWithModel: false, source: 'agent' } }));
        }
      }
    } catch (err) {
      if (!mounted.current || clientIdRef.current !== startedFor) return;
      if (err?.status === 409 && err?.data?.proposal) setProposals((p) => ({ ...p, [proposal.id]: err.data.proposal }));
      setDecideErrors((e) => ({ ...e, [proposal.id]: chatErrorText(err) }));
    } finally {
      if (mounted.current) setDecidingId('');
    }
  }, [decidingId, call, clientId, threadId, useModelIds, memoryStates, onPlanChanged, onRefreshed, onDocChanged]);

  const newThread = () => {
    if (sending) return;
    setThreadId(''); setMessages([]); setProposals({}); setLastUsage(null); setError(''); setDecideErrors({}); setUseModelIds({});
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) { e.preventDefault(); send(); }
  };

  const footer = costFooterText(lastUsage, used, cap);

  const fillPrompt = (t) => {
    setText(t);
    const el = inputRef.current;
    if (el) el.focus({ preventScroll: true });
  };

  return (
    <section id="x-strategy-chat-panel" className="xce-panel" data-section="chat">
      <style>{CHAT_CSS}</style>
      <div id="x-strategy-chat-header" style={S.head}>
        <h3 style={S.h}>Strategy</h3>
        <IconButton
          id="x-strategy-chat-permissions-button"
          label="Agent permissions"
          icon={<Shield size={18} />}
          onClick={() => setShowPermissions((v) => !v)}
        />
        <IconButton
          id="x-strategy-chat-new-thread-button"
          label="New thread"
          icon={<Plus size={18} />}
          disabled={sending || (!messages.length && !threadId)}
          onClick={newThread}
        />
      </div>

      {showPermissions ? <AgentPermissionsPanel clientId={clientId} call={call} /> : null}

      <div id="x-strategy-chat-messages" ref={listRef} role="log" aria-live="polite" style={S.list}>
        {loading ? <div id="x-strategy-chat-loading" className="xce-empty">Loading chat…</div> : null}
        {!loading && !messages.length ? (
          <div id="x-strategy-chat-empty" className="xce-empty" style={{ display: 'grid', gap: 10, justifyItems: 'start' }}>
            <span>Talk through your strategy: your account against your benchmarks, read against the X algorithm. The agent can propose edits to your strategy and plan; nothing changes until you confirm a card.</span>
            <button type="button" id="x-strategy-chat-start-session-button" className="xce-btn" disabled={sending} onClick={() => runTurn({ review: true })}>
              <Sparkles size={15} /> Start strategy session
            </button>
          </div>
        ) : null}
        {timeline.map((item) => {
          if (item.kind === 'doc') {
            const h = item.h;
            const clock = formatClock(h.at);
            return (
              <div key={`doc-${h.version}`} id={`x-strategy-chat-doc-history-row-${h.version}`} data-role="doc-history" style={S.historyRow}>
                <BookOpen size={16} style={{ flex: '0 0 auto' }} />
                <span id={`x-strategy-chat-doc-history-text-${h.version}`} style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                  <b style={{ color: XCE_COLORS.ink }}>You edited the strategy</b> {'·'} {describeDocChange(h).replace(/^Strategy v\d+ - /, '')}{clock ? ` · ${clock}` : ''}
                </span>
                {typeof onViewDoc === 'function' ? (
                  <button type="button" id={`x-strategy-chat-doc-history-view-${h.version}`} style={S.textLink} onClick={onViewDoc}>
                    View <ArrowUpRight size={14} />
                  </button>
                ) : null}
              </div>
            );
          }
          if (item.kind === 'plan') {
            const h = item.h;
            const clock = formatClock(h.at);
            return (
              <div key={`plan-${h.version}`} id={`x-strategy-chat-history-row-${h.version}`} data-role="plan-history" style={S.historyRow}>
                <FileText size={16} style={{ flex: '0 0 auto' }} />
                <span id={`x-strategy-chat-history-text-${h.version}`} style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                  <b style={{ color: XCE_COLORS.ink }}>Manual edit</b> {'·'} {historyDiffSummary(h, 2)} {'·'} v{h.version}{clock ? ` · ${clock}` : ''}
                </span>
                {typeof onViewChange === 'function' ? (
                  <button type="button" id={`x-strategy-chat-history-view-${h.version}`} style={S.textLink} onClick={() => onViewChange(h.version)}>
                    View change <ArrowUpRight size={14} />
                  </button>
                ) : null}
              </div>
            );
          }
          const { m, n } = item;
          const ids = (m.proposalIds || []).filter((pid) => proposals[pid]);
          const clock = formatClock(m.at);
          return (
            <div key={n} id={`x-strategy-chat-message-${n}`} data-role={m.role} style={{ display: 'grid', minWidth: 0 }}>
              <div id={`x-strategy-chat-message-text-${n}`} style={m.role === 'user' ? S.userBubble : S.botBubble}>{plainChatText(m.text)}</div>
              {clock ? <div id={`x-strategy-chat-message-time-${n}`} style={{ ...S.time, justifySelf: m.role === 'user' ? 'end' : 'start' }}>{clock}</div> : null}
              {m.role === 'assistant' && messageUndoChips(m).length ? (
                <div id={`x-strategy-chat-message-undo-${n}`}>
                  {messageUndoChips(m).map((c) => <UndoChip key={c.undoId} undoId={c.undoId} label={c.label} call={call} clientId={clientId} />)}
                </div>
              ) : null}
              {ids.length ? (
                <div id={`x-strategy-chat-message-proposals-${n}`} style={S.cardsCol}>
                  {ids.map((pid) => (
                    <div key={pid} style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                      {proposals[pid].kind === 'action' ? (
                        <ActionProposalCard proposal={proposals[pid]} deciding={decidingId === pid} onDecide={decide} />
                      ) : (
                      <ProposalCard
                        call={call}
                        proposal={proposals[pid]}
                        currentPlan={currentPlan}
                        history={history}
                        planVersion={planVersion}
                        deciding={decidingId === pid}
                        onDecide={decide}
                        useModel={useModelIds[pid]}
                        memoryState={memoryStates[pid]}
                        onMemoryState={(proposalId, next) => setMemoryStates((m) => ({ ...m, [proposalId]: next }))}
                        onUseModel={(id, on) => setUseModelIds((u) => ({ ...u, [id]: on }))}
                        onViewPlan={onViewPlan}
                        onUndo={onUndo}
                        undoNote={undoNote}
                        docSections={docSections}
                        onViewDoc={onViewDoc}
                      />
                      )}
                      {decideErrors[pid] ? <div id={`x-strategy-proposal-error-${pid}`} role="alert" style={{ ...S.err, margin: 0 }}>{decideErrors[pid]}</div> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        {sending ? <div id="x-strategy-chat-thinking" role="status" style={S.botBubble}>thinking…</div> : null}
      </div>

      {error ? <div id="x-strategy-chat-error" role="alert" style={S.err}>{error}</div> : null}

      <div id="x-strategy-chat-composer" style={S.composer}>
        <div id="x-strategy-chat-input-row">
          <textarea
            id="x-strategy-chat-input"
            ref={inputRef}
            rows={1}
            style={S.input}
            value={text}
            maxLength={INPUT_MAX}
            placeholder="Ask or change your strategy…"
            aria-label="Message to the strategy agent"
            disabled={sending}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <IconButton
            id="x-strategy-chat-send-button"
            label={sending ? 'Thinking' : 'Send message'}
            variant="solid"
            size={44}
            icon={<ArrowUp size={20} />}
            disabled={sending || !text.trim()}
            onClick={send}
            style={{ borderRadius: XCE_RADII.pill }}
          />
        </div>
        <div id="x-strategy-chat-prompt-chips-row">
          {PROMPT_CHIPS.map((label) => (
            <button
              key={label}
              type="button"
              id={`x-strategy-chat-prompt-chip-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
              style={S.promptChip}
              disabled={sending}
              onClick={() => fillPrompt(label)}
            >
              {label}
            </button>
          ))}
        </div>
        <SectionLabel
          id="x-strategy-chat-send-row"
          right={<span id="x-strategy-chat-char-count" style={S.label}>{text.length}/{INPUT_MAX}</span>}
          style={{ padding: '0 2px' }}
        >
          <span id="x-strategy-chat-hint">Enter to send {'·'} Shift+Enter for a new line</span>
        </SectionLabel>
      </div>

      <div id="x-strategy-chat-footer" style={S.note}>{footer || 'No turns yet today.'}</div>
    </section>
  );
}
