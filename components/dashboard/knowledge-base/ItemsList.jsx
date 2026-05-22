'use client';

import React from 'react';
import { Trash2 } from 'lucide-react';

function safeId(id) {
  return String(id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function formatDate(value) {
  if (!value) return 'Unknown';
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
  } catch {
    return String(value);
  }
}

export default function ItemsList({ items, loading, deletingId, onDelete }) {
  if (loading) {
    return (
      <div id="kb-items-loading" className="tile-detail-stat-row">
        <span className="tile-detail-stat-label">Loading knowledge items...</span>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div id="kb-empty-state" className="tile-detail-stat-row">
        <span className="tile-detail-stat-label">No Knowledge Base items yet.</span>
        <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          Add pasted text or a URL to begin.
        </span>
      </div>
    );
  }

  return (
    <div id="kb-items-list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((item) => {
        const itemId = safeId(item.id);
        const deleting = deletingId === item.id;
        return (
          <div
            key={item.id}
            id={`kb-item-${itemId}`}
            className="tile-detail-stat-row"
            style={{ alignItems: 'center', gap: 10 }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="tile-detail-stat-label"
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}
                title={item.title}
              >
                {item.title || 'Untitled'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 3 }}>
                <span className={`sb-chip sb-chip--${item.status === 'ready' ? 'ready' : item.status === 'error' ? 'empty' : 'partial'}`}>
                  {item.status || 'ready'}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {item.type}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                  {item.chunkCount || 0} chunks
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                  {formatDate(item.createdAt)}
                </span>
              </div>
              {item.sourceUrl && (
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 11, marginTop: 3, textDecoration: 'none' }}
                >
                  {item.sourceUrl}
                </a>
              )}
              {item.error && (
                <div style={{ color: '#ff8a8a', fontSize: 11, marginTop: 3 }}>{item.error}</div>
              )}
            </div>

            <button
              id={`kb-delete-${itemId}`}
              type="button"
              aria-label={`Delete ${item.title || 'Knowledge Base item'}`}
              title="Delete item"
              onClick={() => onDelete(item.id)}
              disabled={deleting}
              className="sb-link-btn"
              style={{ width: 30, height: 30 }}
            >
              <Trash2 size={14} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
