'use client';
import { useState } from 'react';
import { X } from 'lucide-react';

export default function SendPreviewModal({ open, prospect, onClose, getIdToken }) {
  const [note,      setNote]      = useState(prospect?.outreach?.note || '');
  const [recipient, setRecipient] = useState(prospect?.email || '');
  const [sending,   setSending]   = useState(false);
  const [sent,      setSent]      = useState(false);
  const [error,     setError]     = useState('');

  if (!open || !prospect) return null;

  async function handleSend() {
    if (!recipient.trim()) { setError('Enter a recipient email.'); return; }
    setSending(true);
    setError('');
    try {
      const token = await getIdToken();
      const res   = await fetch('/api/leadgen/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({
          placeId:        prospect.placeId,
          recipientEmail: recipient.trim(),
          editedNote:     note,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Send failed.');
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div id="send-preview-modal-backdrop" style={{
      position: 'fixed', inset: 0, zIndex: 1200,
      background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>

      <div id="send-preview-modal-shell" style={{
        background: '#fff', borderRadius: 18, width: '100%', maxWidth: 640,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.18)',
      }}>

        {/* Head */}
        <div id="send-preview-modal-head" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px', borderBottom: '1px solid #f1f5f9', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Outreach Preview</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#1e293b' }}>{prospect.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div id="send-preview-modal-body" style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Email iframe preview */}
          {prospect.outreach?.emailHtml && (
            <div id="send-preview-email-frame-shell" style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#f8fafc' }}>
              <div style={{ fontSize: 11, color: '#94a3b8', padding: '8px 12px', borderBottom: '1px solid #e2e8f0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email Preview</div>
              <iframe
                id="send-preview-email-iframe"
                srcDoc={prospect.outreach.emailHtml}
                style={{ width: '100%', height: 340, border: 'none', display: 'block' }}
                title="Email preview"
                sandbox="allow-same-origin"
              />
            </div>
          )}

          {/* Editable note */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 6 }}>Personal Note</label>
            <textarea
              id="send-preview-note-textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={5}
              style={{
                width: '100%', boxSizing: 'border-box',
                border: '1px solid #e2e8f0', borderRadius: 8,
                padding: '10px 12px', fontSize: 14, lineHeight: 1.6,
                fontFamily: 'inherit', color: '#1e293b', resize: 'vertical',
                outline: 'none',
              }}
            />
          </div>

          {/* Recipient */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 6 }}>Sending To</label>
            <input
              id="send-preview-recipient-input"
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="owner@business.com"
              style={{
                width: '100%', boxSizing: 'border-box',
                border: '1px solid #e2e8f0', borderRadius: 8,
                padding: '10px 12px', fontSize: 14, fontFamily: 'inherit',
                color: '#1e293b', outline: 'none',
              }}
            />
          </div>

          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626' }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        {sent ? (
          <div id="send-preview-modal-success" style={{
            padding: '24px', borderTop: '1px solid #f1f5f9',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, flexShrink: 0,
          }}>
            <div style={{ fontSize: 28 }}>✅</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1e293b', marginBottom: 4 }}>Email sent to {recipient}</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>The prospect has been marked as contacted.</div>
            </div>
            <button className="leadgen-btn leadgen-btn--primary" onClick={onClose}>Done</button>
          </div>
        ) : (
          <div id="send-preview-modal-foot" style={{
            padding: '16px 24px', borderTop: '1px solid #f1f5f9',
            display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0,
          }}>
            <button
              className="leadgen-btn leadgen-btn--ghost"
              onClick={onClose}
              disabled={sending}
            >
              Cancel
            </button>
            <button
              className="leadgen-btn leadgen-btn--primary"
              onClick={handleSend}
              disabled={sending || !recipient.trim()}
            >
              {sending ? 'Sending…' : 'Send to Owner →'}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
