'use client';

import React, { useEffect, useState } from 'react';

export default function AddItemPanel({ mode, busy, onSubmit }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);

  useEffect(() => {
    setTitle('');
    setText('');
    setUrl('');
    setFile(null);
  }, [mode]);

  const isTextMode = mode === 'text';
  const isUploadMode = mode === 'upload';
  const canSubmit = isUploadMode
    ? Boolean(file)
    : isTextMode
    ? text.trim().length >= 20
    : url.trim().length > 0;
  const submitHint = isUploadMode
    ? 'Choose a file to enable upload.'
    : isTextMode
    ? `${Math.min(text.trim().length, 20)}/20 characters required.`
    : 'Enter a URL to enable import.';

  async function handleSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!canSubmit || busy) return;
    await onSubmit({
      title: title.trim(),
      text: text.trim(),
      url: url.trim(),
      file,
    });
    setTitle('');
    setText('');
    setUrl('');
    setFile(null);
    form.reset();
  }

  return (
    <form id="kb-add-panel" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="mu-field">
        <label className="mu-label" htmlFor="kb-title-input">Title</label>
        <input
          id="kb-title-input"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={160}
          placeholder={isTextMode ? 'Positioning notes, FAQ, offer details' : isUploadMode ? 'Document title (optional)' : 'Source title (optional)'}
          className="mu-input"
        />
      </div>

      {isTextMode ? (
        <div className="mu-field">
          <label className="mu-label" htmlFor="kb-text-input">Pasted Text</label>
          <textarea
            id="kb-text-input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Paste client-owned context: product details, service notes, FAQs, founder notes, whitepaper excerpts, positioning, or sales messaging."
            rows={5}
            className="mu-textarea"
            style={{ minHeight: 118 }}
          />
        </div>
      ) : isUploadMode ? (
        <div className="mu-field">
          <label className="mu-label" htmlFor="kb-file-input">Document Upload</label>
          <input
            id="kb-file-input"
            type="file"
            accept=".pdf,.docx,.txt,.md,.csv,.json,.html,.xml,.yaml,.yml,.rtf,.log"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            className="mu-input"
          />
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: 4 }}>
            Upload PDFs, DOCX, TXT, Markdown, CSV, JSON, HTML, XML, YAML, RTF, logs, and other text-based files. Max 10 MB. Legacy .doc is not supported.
          </span>
        </div>
      ) : (
        <div className="mu-field">
          <label className="mu-label" htmlFor="kb-url-input">URL</label>
          <input
            id="kb-url-input"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/resource"
            className="mu-input"
          />
        </div>
      )}

      <div id="kb-submit-row" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          id="kb-submit"
          type="submit"
          disabled={!canSubmit || busy}
          className="mu-cta-primary"
          style={{ minHeight: 42, padding: '0 20px', fontSize: 13 }}
        >
          {busy ? 'Adding...' : isUploadMode ? 'Upload File' : isTextMode ? 'Add Text' : 'Add URL'}
        </button>
        {!canSubmit && !busy && (
          <span id="kb-submit-hint" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {submitHint}
          </span>
        )}
      </div>
    </form>
  );
}
