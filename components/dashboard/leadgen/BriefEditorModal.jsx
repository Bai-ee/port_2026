'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../firebase';

export default function BriefEditorModal({ open, prospect, onClose, onSaved }) {
  const [text,       setText]       = useState('');
  const [saving,     setSaving]     = useState(false);
  const [notice,     setNotice]     = useState(null);
  const [error,      setError]      = useState(null);
  const textareaRef  = useRef(null);

  // Seed textarea from prospect whenever modal opens
  useEffect(() => {
    if (!open) return;
    setText(prospect?.generation?.designMd || '');
    setNotice(null);
    setError(null);
    setTimeout(() => textareaRef.current?.focus(), 60);
  }, [open, prospect]);

  // ESC closes
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !prospect) return null;

  const lines = text.split('\n').length;
  const chars = text.length;
  const dirty = text !== (prospect?.generation?.designMd || '');

  async function handleSave() {
    if (!prospect?.placeId) return;
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await updateDoc(doc(db, 'leadgen_prospects', prospect.placeId), {
        'generation.designMd': text,
        'generation.briefEditedAt': new Date().toISOString(),
      });
      setNotice('Brief saved.');
      onSaved?.();
    } catch (err) {
      setError(err?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div id="lgbe-backdrop" role="dialog" aria-modal="true" aria-labelledby="lgbe-title">
      <div id="lgbe-shell">

        <header id="lgbe-head">
          <div id="lgbe-head-left">
            <h2 id="lgbe-title">Creative Brief</h2>
            <span id="lgbe-meta">{prospect.name} · {lines} lines</span>
          </div>
          <div id="lgbe-head-right">
            <span id="lgbe-char-count">{chars.toLocaleString()} chars</span>
            <button type="button" className="leadgen-modal-x" onClick={onClose} aria-label="Close">
              <X size={16} strokeWidth={2} />
            </button>
          </div>
        </header>

        <div id="lgbe-body">
          <textarea
            ref={textareaRef}
            id="lgbe-textarea"
            value={text}
            onChange={(e) => { setText(e.target.value); setNotice(null); }}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>

        {error  ? <div className="lgbe-msg lgbe-msg--err">{error}</div>  : null}
        {notice ? <div className="lgbe-msg lgbe-msg--ok">{notice}</div>  : null}

        <footer id="lgbe-foot">
          <span id="lgbe-foot-hint">
            {dirty ? 'Unsaved changes' : 'No changes'}
          </span>
          <div id="lgbe-foot-actions">
            <button type="button" className="leadgen-btn leadgen-btn--ghost" onClick={onClose} disabled={saving}>
              Close
            </button>
            <button
              type="button"
              className="leadgen-btn leadgen-btn--primary"
              onClick={handleSave}
              disabled={saving || !dirty}
            >
              {saving ? 'Saving…' : 'Save Brief'}
            </button>
          </div>
        </footer>
      </div>

      <style jsx>{`
        #lgbe-backdrop {
          position: fixed; inset: 0;
          background: rgba(15, 15, 15, 0.42);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          animation: lgbe-fade 180ms ease-out;
        }
        @keyframes lgbe-fade { from { opacity: 0; } to { opacity: 1; } }

        #lgbe-shell {
          width: min(820px, 96vw);
          height: min(88vh, 900px);
          display: flex;
          flex-direction: column;
          background: #fafafa;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 8px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          color: #1a1a1a;
          overflow: hidden;
        }

        #lgbe-head {
          flex-shrink: 0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 22px;
          border-bottom: 1px dashed rgba(0,0,0,0.10);
          gap: 12px;
        }
        #lgbe-head-left {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        #lgbe-title {
          margin: 0;
          font-size: 15px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        #lgbe-meta {
          font-size: 11px;
          color: #888;
        }
        #lgbe-head-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        #lgbe-char-count {
          font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
          font-size: 10px;
          color: #aaa;
          letter-spacing: 0.04em;
        }

        #lgbe-body {
          flex: 1;
          overflow: hidden;
          padding: 0;
        }
        #lgbe-textarea {
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

        .lgbe-msg {
          flex-shrink: 0;
          margin: 0 22px;
          font-size: 12px;
          padding: 7px 10px;
          border-radius: 8px;
        }
        .lgbe-msg--err {
          color: #ff3b30;
          background: rgba(255, 59, 48, 0.06);
          border: 1px solid rgba(255, 59, 48, 0.22);
        }
        .lgbe-msg--ok {
          color: #166534;
          background: rgba(22, 101, 52, 0.06);
          border: 1px solid rgba(22, 101, 52, 0.18);
        }

        #lgbe-foot {
          flex-shrink: 0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 22px;
          border-top: 1px dashed rgba(0,0,0,0.10);
          gap: 12px;
        }
        #lgbe-foot-hint {
          font-size: 11px;
          color: #aaa;
        }
        #lgbe-foot-actions {
          display: flex;
          gap: 8px;
        }

        @media (max-width: 600px) {
          #lgbe-shell { height: 100dvh; border-radius: 0; }
          #lgbe-backdrop { padding: 0; }
        }
      `}</style>
    </div>
  );
}
