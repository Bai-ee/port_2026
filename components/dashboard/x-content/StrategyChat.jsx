'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  proposalKindLabel, proposalPayloadPreview, proposalStatusText, chatErrorText, costFooterText,
} from '../../../features/x-strategy/ui-model.js';

// StrategyChat - the agent chat in the Strategy tab's right column.
//
//   <StrategyChat clientId call onPlanChanged onRefreshed currentPlan? />
//
// `call(action, body)` is the card's quote-targets POST helper (throws errors with .status / .data).
// One request per turn (non-streaming). The agent only PROPOSES; nothing runs until the owner presses
// Confirm on a card. The active threadId lives in component state only; strategy-chat-history restores the
// latest thread on mount.

const INPUT_MAX = 2000;

const S = {
  h: { margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.7)' },
  head: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  list: { display: 'grid', gap: 10, minWidth: 0, maxHeight: 460, overflowY: 'auto', padding: '2px 2px 6px', alignContent: 'start' },
  userBubble: { justifySelf: 'end', maxWidth: '92%', padding: '8px 11px', borderRadius: 12, background: 'rgba(42,36,32,0.88)', color: '#fff', fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  botBubble: { justifySelf: 'start', maxWidth: '100%', padding: '8px 11px', borderRadius: 12, background: 'rgba(42,36,32,0.06)', border: '1px solid rgba(42,36,32,0.1)', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  cardsCol: { display: 'grid', gap: 8, marginTop: 8, minWidth: 0 },
  card: { padding: '10px 11px', borderRadius: 12, background: '#fff', border: '1px solid rgba(42,36,32,0.14)', display: 'grid', gap: 6, minWidth: 0 },
  cardHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  kind: { fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.6)' },
  summary: { fontSize: 13, fontWeight: 600, lineHeight: 1.4, overflowWrap: 'anywhere' },
  rationale: { margin: 0, fontSize: 12, lineHeight: 1.45, color: 'rgba(42,36,32,0.7)', overflowWrap: 'anywhere' },
  small: { margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.45, overflowWrap: 'anywhere' },
  preview: { margin: 0, padding: '6px 8px', borderRadius: 8, background: 'rgba(42,36,32,0.05)', listStyle: 'none', fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.5, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' },
  label: { fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.55)' },
  row: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  err: { margin: '8px 0 0', fontSize: 12, lineHeight: 1.4, color: '#9f1f17' },
  note: { margin: '6px 0 0', fontSize: 12, lineHeight: 1.45, color: 'rgba(42,36,32,0.6)' },
  ok: { margin: 0, fontSize: 12, lineHeight: 1.4, color: '#1f6b3a' },
  input: { width: '100%', boxSizing: 'border-box', minHeight: 58, resize: 'vertical', padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(42,36,32,0.2)', font: 'inherit', fontSize: 13, lineHeight: 1.4 },
};

const STATUS_STYLE = {
  pending: { background: 'rgba(183,121,31,0.12)', color: '#8a5a15' },
  ok: { background: 'rgba(31,107,58,0.12)', color: '#1f6b3a' },
  muted: { background: 'rgba(42,36,32,0.08)', color: 'rgba(42,36,32,0.65)' },
  error: { background: 'rgba(159,31,23,0.1)', color: '#9f1f17' },
};

const CHAT_CSS = `
  #x-strategy-chat-panel { display: grid; gap: 0; min-width: 0; }
  #x-strategy-chat-composer { margin-top: 8px; display: grid; gap: 6px; }
  @media (max-width: 480px) {
    #x-strategy-chat-messages { max-height: 52vh; }
    #x-strategy-chat-composer { position: sticky; bottom: 0; background: inherit; padding-top: 6px; }
    #x-strategy-chat-send-button { width: 100%; }
  }
`;

function ProposalCard({ proposal, currentPlan, deciding, onDecide, useModel, onUseModel }) {
  const id = proposal.id;
  const st = proposalStatusText(proposal);
  const preview = proposalPayloadPreview(proposal.kind, proposal.payload, currentPlan);
  const evidence = Array.isArray(proposal.evidence) ? proposal.evidence : [];
  const pending = proposal.status === 'pending';
  return (
    <div id={`x-strategy-proposal-${id}`} data-section="chat-proposal" style={S.card}>
      <div id={`x-strategy-proposal-header-${id}`} style={S.cardHead}>
        <span style={S.kind}>{proposalKindLabel(proposal.kind)}</span>
        <span id={`x-strategy-proposal-status-${id}`} className="xce-chip" style={STATUS_STYLE[st.tone] || STATUS_STYLE.muted}>{st.label}</span>
      </div>
      {proposal.summary ? <div id={`x-strategy-proposal-summary-${id}`} style={S.summary}>{proposal.summary}</div> : null}
      {proposal.rationale ? <p id={`x-strategy-proposal-rationale-${id}`} style={S.rationale}>{proposal.rationale}</p> : null}
      {evidence.length ? (
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
      {st.detail ? (
        <p id={`x-strategy-proposal-result-${id}`} role="status" style={st.tone === 'error' ? { ...S.err, margin: 0 } : st.tone === 'ok' ? S.ok : S.note}>{st.detail}</p>
      ) : null}
      {proposal.kind === 'item-story' && proposal.payload?.sourceQuote ? (
        <p id={`x-strategy-proposal-source-quote-${id}`} style={S.rationale}>Your words: {'\u201C'}{proposal.payload.sourceQuote}{'\u201D'}</p>
      ) : null}
      {pending && proposal.kind === 'regenerate-today' ? (
        <label id={`x-strategy-proposal-usemodel-row-${id}`} style={{ ...S.rationale, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" id={`x-strategy-proposal-usemodel-${id}`} checked={!!useModel} disabled={deciding} onChange={(e) => onUseModel(id, e.target.checked)} />
          Use the model to redraft {'\u2014'} costs a few cents
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
    </div>
  );
}

export default function StrategyChat({ clientId, call, onPlanChanged, onRefreshed, currentPlan }) {
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

  const mounted = useRef(true);
  const listRef = useRef(null);
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

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || sending || typeof call !== 'function') return;
    const startedFor = clientId; // a response for a client that is no longer shown must not touch state
    setSending(true);
    setError('');
    setMessages((m) => [...m, { role: 'user', text: body, pending: true }]);
    setText('');
    try {
      const res = await call('strategy-chat-send', { clientId, text: body, ...(threadId ? { threadId } : {}) });
      if (!mounted.current || clientIdRef.current !== startedFor) return;
      const fresh = Array.isArray(res.proposals) ? res.proposals : [];
      setThreadId(res.threadId || threadId);
      setMessages((m) => [
        ...m.map((x) => (x.pending ? { role: x.role, text: x.text } : x)),
        { role: 'assistant', text: res.text || '', ...(fresh.length ? { proposalIds: fresh.map((p) => p.id) } : {}) },
      ]);
      if (fresh.length) setProposals((p) => ({ ...p, ...Object.fromEntries(fresh.map((x) => [x.id, x])) }));
      setUsed(res.turnsUsedToday); setCap(res.cap); setLastUsage(res.usage ?? null);
    } catch (err) {
      if (!mounted.current || clientIdRef.current !== startedFor) return;
      // The turn was not recorded: take the optimistic message back and restore the draft.
      setMessages((m) => m.filter((x) => !x.pending));
      setText(body);
      setError(chatErrorText(err));
      const d = err?.data;
      if (d?.turnsUsedToday !== undefined) setUsed(d.turnsUsedToday);
      if (d?.cap !== undefined) setCap(d.cap);
      if (err?.status === 429 && d?.used !== undefined) setUsed(d.used);
    } finally {
      if (mounted.current) setSending(false); // always release the busy flag (it is not client-specific data)
    }
  }, [text, sending, call, clientId, threadId]);

  const decide = useCallback(async (proposal, decision) => {
    if (decidingId || typeof call !== 'function') return;
    const startedFor = clientId;
    setDecidingId(proposal.id);
    setDecideErrors((e) => ({ ...e, [proposal.id]: '' }));
    try {
      const options = decision === 'confirm' && proposal.kind === 'regenerate-today' && useModelIds[proposal.id] ? { useModel: true } : undefined;
      const res = await call('strategy-proposal-decide', { clientId, threadId: proposal.threadId || threadId, proposalId: proposal.id, decision, ...(options ? { options } : {}) });
      if (!mounted.current || clientIdRef.current !== startedFor) return;
      const next = res.proposal || { ...proposal, status: decision === 'confirm' ? 'confirmed' : 'rejected' };
      setProposals((p) => ({ ...p, [proposal.id]: next }));
      if (next.status === 'confirmed') {
        if (next.kind === 'plan-change' && typeof onPlanChanged === 'function') onPlanChanged();
        if (next.kind === 'refresh-handles' && typeof onRefreshed === 'function') onRefreshed();
      }
    } catch (err) {
      if (!mounted.current || clientIdRef.current !== startedFor) return;
      if (err?.status === 409 && err?.data?.proposal) setProposals((p) => ({ ...p, [proposal.id]: err.data.proposal }));
      setDecideErrors((e) => ({ ...e, [proposal.id]: chatErrorText(err) }));
    } finally {
      if (mounted.current) setDecidingId('');
    }
  }, [decidingId, call, clientId, threadId, useModelIds, onPlanChanged, onRefreshed]);

  const newThread = () => {
    if (sending) return;
    setThreadId(''); setMessages([]); setProposals({}); setLastUsage(null); setError(''); setDecideErrors({}); setUseModelIds({});
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) { e.preventDefault(); send(); }
  };

  const footer = costFooterText(lastUsage, used, cap);

  return (
    <section id="x-strategy-chat-panel" className="xce-panel" data-section="chat">
      <style>{CHAT_CSS}</style>
      <div id="x-strategy-chat-header" style={S.head}>
        <h3 style={S.h}>Strategy chat</h3>
        <button type="button" id="x-strategy-chat-new-thread-button" className="xce-btn xce-btn-ghost" disabled={sending || (!messages.length && !threadId)} onClick={newThread}>
          New thread
        </button>
      </div>

      <div id="x-strategy-chat-messages" ref={listRef} role="log" aria-live="polite" style={S.list}>
        {loading ? <div id="x-strategy-chat-loading" className="xce-empty">Loading chat…</div> : null}
        {!loading && !messages.length ? (
          <div id="x-strategy-chat-empty" className="xce-empty">
            Ask about your numbers or the plan. The agent can suggest changes; nothing happens until you confirm a card.
          </div>
        ) : null}
        {messages.map((m, n) => {
          const ids = (m.proposalIds || []).filter((pid) => proposals[pid]);
          return (
            <div key={n} id={`x-strategy-chat-message-${n}`} data-role={m.role} style={{ display: 'grid', minWidth: 0 }}>
              <div id={`x-strategy-chat-message-text-${n}`} style={m.role === 'user' ? S.userBubble : S.botBubble}>{m.text}</div>
              {ids.length ? (
                <div id={`x-strategy-chat-message-proposals-${n}`} style={S.cardsCol}>
                  {ids.map((pid) => (
                    <div key={pid} style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                      <ProposalCard proposal={proposals[pid]} currentPlan={currentPlan} deciding={decidingId === pid} onDecide={decide} useModel={useModelIds[pid]} onUseModel={(id, on) => setUseModelIds((u) => ({ ...u, [id]: on }))} />
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

      <div id="x-strategy-chat-composer">
        <textarea
          id="x-strategy-chat-input"
          style={S.input}
          value={text}
          maxLength={INPUT_MAX}
          placeholder="Ask about your plan or numbers (Enter to send, Shift+Enter for a new line)"
          aria-label="Message to the strategy agent"
          disabled={sending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div id="x-strategy-chat-send-row" style={S.row}>
          <button type="button" id="x-strategy-chat-send-button" className="xce-btn" disabled={sending || !text.trim()} onClick={send}>
            {sending ? 'Thinking…' : 'Send'}
          </button>
          <span id="x-strategy-chat-char-count" style={S.label}>{text.length}/{INPUT_MAX}</span>
        </div>
      </div>

      <div id="x-strategy-chat-footer" style={S.note}>{footer || 'No turns yet today.'}</div>
    </section>
  );
}
