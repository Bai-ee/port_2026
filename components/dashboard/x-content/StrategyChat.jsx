'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, BookOpen, Check, FileText, Plus, Shield, Sparkles } from 'lucide-react';
import {
  memorySuggestModel,
  proposalKindLabel, proposalPayloadPreview, proposalStatusText, chatErrorText, costFooterText, plainChatText, chatBlocks,
  historyDiffSummary,
} from '../../../features/x-strategy/ui-model.js';
import { describeDocChange, sectionTitle } from '../../../features/x-strategy/strategy-doc.js';
import { XCE_COLORS, XCE_RADII } from '../content-ui/xce-tokens';
import Accordion from '../content-ui/ui/Accordion';
import IconButton from '../content-ui/ui/IconButton';
import MiniThumb from './MiniThumb.jsx';
import ActionProposalCard from './ActionProposalCard.jsx';
import UndoChip from './UndoChip.jsx';
import AgentPermissionsPanel from './AgentPermissionsPanel.jsx';
import { messageUndoChips } from '../../../features/x-strategy/action-ui-model.js';
import MemorySuggestRows from './MemorySuggestRows.jsx';

// StrategyChat - the agent chat in the Strategy panel's Chat tab (full width, one centred reading column).
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

// Readable secondary text: the shared inkSoft/inkMuted (62% / 50%) read as washed out at chat sizes.
const INK_SECONDARY = 'color-mix(in srgb, var(--t-text) 74%, transparent)';
const INK_META = 'color-mix(in srgb, var(--t-text) 64%, transparent)';

const S = {
  list: { display: 'grid', gap: 18, minWidth: 0, padding: '4px 0 8px', alignContent: 'start' },
  userBubble: { justifySelf: 'end', maxWidth: '85%', padding: '10px 14px', borderRadius: 18, background: XCE_COLORS.ink, color: XCE_COLORS.onInk, fontSize: 15, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  // Agent replies read as plain text on the page (no grey box), so long answers stay easy to scan.
  botText: { justifySelf: 'stretch', minWidth: 0, display: 'grid', gap: 10, fontSize: 15, lineHeight: 1.6, color: XCE_COLORS.ink, overflowWrap: 'anywhere' },
  botP: { margin: 0, whiteSpace: 'pre-wrap' },
  botH: { margin: '4px 0 0', fontSize: 15, fontWeight: 700 },
  botList: { margin: 0, paddingLeft: 22, display: 'grid', gap: 4 },
  time: { margin: '4px 2px 0', fontSize: 12, color: INK_META },
  thinking: { justifySelf: 'start', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, color: INK_SECONDARY },
  cardsCol: { display: 'grid', gap: 10, marginTop: 10, minWidth: 0 },
  card: { padding: '14px 16px', borderRadius: XCE_RADII.md + 2, background: XCE_COLORS.surface, border: `1px solid ${XCE_COLORS.borderStrong}`, display: 'grid', gap: 8, minWidth: 0 },
  cardHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  kind: { fontSize: 12.5, fontWeight: 600, color: INK_SECONDARY },
  status: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 600 },
  summary: { fontSize: 15.5, fontWeight: 700, lineHeight: 1.4, overflowWrap: 'anywhere' },
  rationale: { margin: 0, fontSize: 13.5, lineHeight: 1.5, color: INK_SECONDARY, overflowWrap: 'anywhere' },
  small: { margin: 0, paddingLeft: 16, fontSize: 12.5, lineHeight: 1.45, overflowWrap: 'anywhere' },
  preview: { margin: 0, padding: '6px 8px', borderRadius: 8, background: XCE_COLORS.greyBg, listStyle: 'none', fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.5, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' },
  label: { fontSize: 12, fontWeight: 600, color: INK_SECONDARY },
  row: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  err: { margin: '8px 0 0', fontSize: 12, lineHeight: 1.4, color: XCE_COLORS.red },
  note: { margin: '6px 0 0', fontSize: 12.5, lineHeight: 1.45, color: INK_META },
  ok: { margin: 0, fontSize: 12, lineHeight: 1.4, color: XCE_COLORS.green },
  textLink: { display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 36, padding: '0 4px', border: 0, background: 'transparent', color: XCE_COLORS.ink, fontSize: 13, textDecoration: 'underline', cursor: 'pointer' },
  historyRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', fontSize: 13, color: INK_SECONDARY, minWidth: 0 },
  composer: { display: 'grid', gap: 6, padding: 8, border: `1px solid ${XCE_COLORS.borderStrong}`, borderRadius: XCE_RADII.lg, background: XCE_COLORS.surface },
  input: { flex: '1 1 auto', minWidth: 0, boxSizing: 'border-box', minHeight: 44, maxHeight: 160, resize: 'none', padding: '10px 8px', border: 0, outline: 'none', background: 'transparent', color: XCE_COLORS.ink, font: 'inherit', fontSize: 16, lineHeight: 1.45 },
  hint: { fontSize: 12, color: INK_META, padding: '0 8px' },
  starter: { display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 40, padding: 0, border: 0, background: 'transparent', color: XCE_COLORS.ink, fontSize: 14.5, textAlign: 'left', textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer' },
};

// Statuses read as plain coloured text (no pill); confirmed adds a check.
const STATUS_COLOR = { pending: XCE_COLORS.amber, ok: XCE_COLORS.green, muted: INK_SECONDARY, error: XCE_COLORS.red };

// One agent reply rendered from chatBlocks(): paragraphs, headings, bullet and numbered lists, **bold** runs.
function ChatText({ id, text }) {
  const runs = (rs) => rs.map((r, i) => (r.bold ? <b key={i}>{r.text}</b> : <React.Fragment key={i}>{r.text}</React.Fragment>));
  return (
    <div id={id} style={S.botText}>
      {chatBlocks(text).map((b, i) => {
        if (b.type === 'h') return <p key={i} style={S.botH}>{runs(b.runs)}</p>;
        if (b.type === 'ul' || b.type === 'ol') {
          const Tag = b.type;
          return <Tag key={i} style={S.botList}>{b.items.map((item, j) => <li key={j}>{runs(item)}</li>)}</Tag>;
        }
        return <p key={i} style={S.botP}>{runs(b.runs)}</p>;
      })}
    </div>
  );
}

// Layout only. Every selector is prefixed with the panel id. The message list has NO inner scroll: the modal
// scrolls the whole page. The composer dock is sticky to the bottom of the modal on wider screens; on phones it
// stays IN FLOW, because the card's phone bottom nav is itself sticky and a sticky composer slid underneath it.
const CHAT_CSS = `
  #x-strategy-chat-panel { display: grid; gap: 0; min-width: 0; width: 100%; max-width: 780px; margin: 0 auto; align-content: start; }
  #x-strategy-chat-toolbar { display: flex; justify-content: flex-end; gap: 8px; min-height: 36px; }
  #x-strategy-chat-permissions-button, #x-strategy-chat-new-thread-button { display: inline-flex; align-items: center; gap: 4px; min-height: 36px; padding: 0 6px; border: 0; background: transparent; color: var(--t-text); font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; }
  #x-strategy-chat-new-thread-button:disabled { opacity: 0.4; cursor: default; }
  #x-strategy-chat-messages { min-height: 120px; }
  #x-strategy-chat-composer-dock { position: sticky; bottom: 0; z-index: 2; display: grid; gap: 6px; padding: 12px 0 14px; background: linear-gradient(to bottom, transparent, var(--t-surface) 14px); box-shadow: 0 32px 0 0 var(--t-surface); }
  #x-strategy-chat-input-row { display: flex; align-items: flex-end; gap: 8px; }
  #x-strategy-chat-send-row { display: flex; justify-content: space-between; gap: 8px; }
  #x-strategy-chat-jump-latest { justify-self: center; display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 14px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--t-text) 24%, transparent); background: var(--t-surface); color: var(--t-text); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 8px color-mix(in srgb, var(--t-text) 12%, transparent); }
  #x-strategy-chat-empty { display: grid; gap: 14px; justify-items: start; padding: 8px 0 4px; }
  #x-strategy-chat-starters { display: grid; gap: 2px; justify-items: start; }
  @media (max-width: 480px) {
    #x-strategy-chat-composer-dock { position: static; background: none; padding-bottom: 4px; }
    #x-strategy-chat-hint { display: none; }
  }
`;

// The char counter only appears near the limit.
const COUNT_FROM = 1600;

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
        <div id={`x-strategy-proposal-main-${id}`} style={{ display: 'grid', gap: 6, flex: 1, minWidth: 0 }}>
          <div id={`x-strategy-proposal-header-${id}`} style={S.cardHead}>
            <span style={S.kind}>
              {confirmed && isPlanChange ? 'Plan updated' : confirmed && isDocEdit ? 'Strategy updated' : proposalKindLabel(proposal.kind)}
              {fromMcp ? <span id={`x-strategy-proposal-from-mcp-badge-${id}`} style={{ color: XCE_COLORS.blue }}> · from MCP</span> : null}
            </span>
            <span id={`x-strategy-proposal-status-${id}`} style={{ ...S.status, color: STATUS_COLOR[st.tone] || INK_SECONDARY }}>
              {confirmed ? <Check size={14} /> : null}{badgeLabel}
            </span>
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
  const endRef = useRef(null);        // sentinel after the composer: visible = the owner is at the latest message
  const atBottomRef = useRef(true);
  const [unseen, setUnseen] = useState(false); // a reply arrived while the owner was scrolled up
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

  // Smart scroll. The page (the modal) scrolls, not the list, so "at the bottom" = the end sentinel is in view.
  useEffect(() => {
    const el = endRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([entry]) => {
      atBottomRef.current = entry.isIntersecting;
      if (entry.isIntersecting) setUnseen(false);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const scrollToLatest = useCallback((smooth = true) => {
    const el = endRef.current;
    // offsetParent is null while the Chat tab is hidden: never scroll the modal for a pane the owner cannot see.
    if (el && el.offsetParent !== null) el.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' });
    setUnseen(false);
  }, []);
  // Open on the latest message once the thread loads.
  useEffect(() => {
    if (!loading && messages.length) scrollToLatest(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);
  // New messages follow only when the owner is already at the bottom; otherwise offer "New message".
  // The owner's own send always follows (runTurn sets atBottomRef first).
  const prevCount = useRef(0);
  useEffect(() => {
    const grew = messages.length > prevCount.current;
    prevCount.current = messages.length;
    if (!grew || loading) return;
    if (atBottomRef.current) scrollToLatest();
    else setUnseen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

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
    atBottomRef.current = true; // the owner's own message always scrolls into view
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
    <section id="x-strategy-chat-panel" data-section="chat">
      <style>{CHAT_CSS}</style>
      <div id="x-strategy-chat-toolbar">
        <button
          type="button"
          id="x-strategy-chat-permissions-button"
          aria-label="Agent permissions"
          aria-expanded={showPermissions}
          onClick={() => setShowPermissions((v) => !v)}
        >
          <Shield size={16} /> Permissions
        </button>
        <button
          type="button"
          id="x-strategy-chat-new-thread-button"
          disabled={sending || (!messages.length && !threadId)}
          onClick={newThread}
        >
          <Plus size={16} /> New thread
        </button>
      </div>

      {showPermissions ? <AgentPermissionsPanel clientId={clientId} call={call} /> : null}

      <div id="x-strategy-chat-messages" role="log" aria-live="polite" style={S.list}>
        {loading ? <div id="x-strategy-chat-loading" style={S.thinking}>Loading chat…</div> : null}
        {!loading && !messages.length ? (
          <div id="x-strategy-chat-empty">
            <p style={{ ...S.botP, fontSize: 15, lineHeight: 1.6 }}>Talk through your strategy: your account against your benchmarks, read against the X algorithm. The agent can propose edits to your strategy and plan; nothing changes until you confirm a card.</p>
            <button type="button" id="x-strategy-chat-start-session-button" className="xce-btn" disabled={sending} onClick={() => runTurn({ review: true })}>
              <Sparkles size={15} /> Start strategy session
            </button>
            <div id="x-strategy-chat-starters">
              <span style={S.label}>Or ask</span>
              {PROMPT_CHIPS.map((label) => (
                <button
                  key={label}
                  type="button"
                  id={`x-strategy-chat-prompt-chip-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  style={S.starter}
                  disabled={sending}
                  onClick={() => fillPrompt(label)}
                >
                  {label}
                </button>
              ))}
            </div>
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
              {m.role === 'user'
                ? <div id={`x-strategy-chat-message-text-${n}`} style={S.userBubble}>{plainChatText(m.text)}</div>
                : <ChatText id={`x-strategy-chat-message-text-${n}`} text={m.text} />}
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
        {sending ? <div id="x-strategy-chat-thinking" role="status" style={S.thinking}>Thinking…</div> : null}
      </div>

      {error ? <div id="x-strategy-chat-error" role="alert" style={S.err}>{error}</div> : null}

      <div id="x-strategy-chat-composer-dock">
        {unseen ? (
          <button type="button" id="x-strategy-chat-jump-latest" onClick={() => scrollToLatest()}>
            <ArrowDown size={15} /> New message
          </button>
        ) : null}
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
        </div>
        <div id="x-strategy-chat-send-row" style={S.hint}>
          <span id="x-strategy-chat-footer">{footer || 'No turns yet today.'}</span>
          <span>
            <span id="x-strategy-chat-hint">Enter to send {'·'} Shift+Enter for a new line</span>
            {text.length >= COUNT_FROM ? <span id="x-strategy-chat-char-count"> {text.length}/{INPUT_MAX}</span> : null}
          </span>
        </div>
      </div>
      <div id="x-strategy-chat-end-sentinel" ref={endRef} aria-hidden="true" style={{ height: 1 }} />
    </section>
  );
}
