'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../firebase';

export default function SitePromptEditorModal({ open, prospect, onClose, onSaved }) {
  const [text,   setText]   = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error,  setError]  = useState(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setText(prospect?.generation?.sitePrompt || '');
    setNotice(null);
    setError(null);
    setTimeout(() => textareaRef.current?.focus(), 60);
  }, [open, prospect]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !prospect) return null;

  const chars = text.length;
  const lines = text.split('\n').length;
  const dirty = text !== (prospect?.generation?.sitePrompt || '');

  async function handleSave() {
    if (!prospect?.placeId) return;
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await updateDoc(doc(db, 'leadgen_prospects', prospect.placeId), {
        'generation.sitePrompt':         text,
        'generation.sitePromptEditedAt': new Date().toISOString(),
      });
      setNotice('Prompt saved. Next Generate Site run will use this prompt.');
      onSaved?.();
    } catch (err) {
      setError(err?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div id="lgspe-backdrop" role="dialog" aria-modal="true" aria-labelledby="lgspe-title">
      <div id="lgspe-shell">

        <header id="lgspe-head">
          <div id="lgspe-head-left">
            <h2 id="lgspe-title">Site Generation Prompt</h2>
            <span id="lgspe-meta">{prospect.name} · {lines} lines · {chars.toLocaleString()} chars</span>
          </div>
          <div id="lgspe-head-right">
            {prospect.generation?.sitePromptEditedAt ? (
              <span id="lgspe-edited-badge">edited</span>
            ) : null}
            <button type="button" className="leadgen-modal-x" onClick={onClose} aria-label="Close">
              <X size={16} strokeWidth={2} />
            </button>
          </div>
        </header>

        <div id="lgspe-body">
          <textarea
            ref={textareaRef}
            id="lgspe-textarea"
            value={text}
            onChange={(e) => { setText(e.target.value); setNotice(null); }}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>

        {error  ? <div className="lgspe-msg lgspe-msg--err">{error}</div>  : null}
        {notice ? <div className="lgspe-msg lgspe-msg--ok">{notice}</div>  : null}

        <footer id="lgspe-foot">
          <span id="lgspe-foot-hint">
            {dirty ? 'Unsaved changes' : 'No changes · Generate Site will use this prompt'}
          </span>
          <div id="lgspe-foot-actions">
            <button type="button" className="leadgen-btn leadgen-btn--ghost" onClick={onClose} disabled={saving}>
              Close
            </button>
            <button
              type="button"
              className="leadgen-btn leadgen-btn--primary"
              onClick={handleSave}
              disabled={saving || !dirty}
            >
              {saving ? 'Saving…' : 'Save Prompt'}
            </button>
          </div>
        </footer>
      </div>

      <style jsx>{`
        #lgspe-backdrop {
          position: fixed; inset: 0;
          background: rgba(15, 15, 15, 0.42);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          animation: lgspe-fade 180ms ease-out;
        }
        @keyframes lgspe-fade { from { opacity: 0; } to { opacity: 1; } }

        #lgspe-shell {
          width: min(820px, 96vw);
          height: min(88vh, 900px);
          display: flex;
          flex-direction: column;
          background: #fafafa;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 18px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18);
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          color: #1a1a1a;
          overflow: hidden;
        }

        #lgspe-head {
          flex-shrink: 0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 22px;
          border-bottom: 1px dashed rgba(0,0,0,0.10);
          gap: 12px;
        }
        #lgspe-head-left {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        #lgspe-title {
          margin: 0;
          font-size: 15px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        #lgspe-meta {
          font-size: 11px;
          color: #888;
        }
        #lgspe-head-right {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        #lgspe-edited-badge {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #b45309;
          background: rgba(180, 83, 9, 0.08);
          border: 1px solid rgba(180, 83, 9, 0.22);
          border-radius: 5px;
          padding: 2px 6px;
        }

        #lgspe-body {
          flex: 1;
          overflow: hidden;
        }
        #lgspe-textarea {
          width: 100%;
          height: 100%;
          padding: 18px 22px;
          border: none;
          outline: none;
          resize: none;
          background: transparent;
          font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
          font-size: 12px;
          line-height: 1.7;
          color: #1a1a1a;
          tab-size: 2;
          box-sizing: border-box;
        }

        .lgspe-msg {
          flex-shrink: 0;
          margin: 0 22px;
          font-size: 12px;
          padding: 7px 10px;
          border-radius: 8px;
        }
        .lgspe-msg--err {
          color: #ff3b30;
          background: rgba(255, 59, 48, 0.06);
          border: 1px solid rgba(255, 59, 48, 0.22);
        }
        .lgspe-msg--ok {
          color: #166534;
          background: rgba(22, 101, 52, 0.06);
          border: 1px solid rgba(22, 101, 52, 0.18);
        }

        #lgspe-foot {
          flex-shrink: 0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 22px;
          border-top: 1px dashed rgba(0,0,0,0.10);
          gap: 12px;
        }
        #lgspe-foot-hint {
          font-size: 11px;
          color: #aaa;
        }
        #lgspe-foot-actions {
          display: flex;
          gap: 8px;
        }

        @media (max-width: 600px) {
          #lgspe-shell { height: 100dvh; border-radius: 0; }
          #lgspe-backdrop { padding: 0; }
        }
      `}</style>
    </div>
  );
}
