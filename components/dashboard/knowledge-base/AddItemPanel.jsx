'use client';

import React, { useEffect, useState } from 'react';

import { isJunkPath } from '../../../features/knowledge-base/brain-layout.js';

const UPLOADABLE_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.html', '.htm', '.xml', '.yaml', '.yml', '.rtf', '.log'];

// Folder picks include everything; keep the files the Source Library can read.
function isBrainUploadable(file) {
  const path = file.webkitRelativePath || file.name || '';
  if (isJunkPath(path)) return false;
  const name = String(file.name || '').toLowerCase();
  return UPLOADABLE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export default function AddItemPanel({ mode, busy, onSubmit }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [files, setFiles] = useState([]);

  useEffect(() => {
    setTitle('');
    setText('');
    setUrl('');
    setFiles([]);
  }, [mode]);

  const isTextMode = mode === 'text';
  const isUploadMode = mode === 'upload';
  const canSubmit = isUploadMode
    ? files.length > 0
    : isTextMode
    ? text.trim().length >= 20
    : url.trim().length > 0;
  const submitHint = isUploadMode
    ? 'Choose one or more files to enable upload.'
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
      files,
    });
    setTitle('');
    setText('');
    setUrl('');
    setFiles([]);
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
          placeholder={isTextMode ? 'Positioning notes, FAQ, offer details' : isUploadMode ? 'Document title (optional, single file only)' : 'Source title (optional)'}
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
            multiple
            accept={UPLOADABLE_EXTENSIONS.join(',')}
            onChange={(event) => setFiles(Array.from(event.target.files || []))}
            className="mu-input"
          />
          <label className="mu-label" htmlFor="kb-folder-input" style={{ marginTop: 10 }}>Or a Brain Folder</label>
          <input
            id="kb-folder-input"
            type="file"
            multiple
            ref={(el) => {
              if (el) {
                el.setAttribute('webkitdirectory', '');
                el.setAttribute('directory', '');
              }
            }}
            onChange={(event) => setFiles(Array.from(event.target.files || []).filter(isBrainUploadable))}
            className="mu-input"
          />
          <span id="kb-upload-help" style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: 4 }}>
            Files are filed like the company brain: MASTER_BRAIN.md, INDEX.md and manifest.json at the root, dated analysis docs beside them, raw evidence in sources/, snapshots in versions/. A loose file is filed under sources/ with today&apos;s date. Re-uploading an unchanged file is skipped; a changed file replaces the current one and the old copy moves to versions/. PDF, DOCX, Markdown, TXT, CSV, JSON, HTML, XML, YAML, RTF and logs, max 10 MB each.
          </span>
          {files.length > 1 && (
            <span id="kb-file-count-hint" style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
              {files.length} files selected.
            </span>
          )}
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
          {busy
            ? 'Adding...'
            : isUploadMode
            ? files.length > 1 ? `Upload ${files.length} Files` : 'Upload File'
            : isTextMode ? 'Add Text' : 'Add URL'}
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
