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
    return <p className="mu-notice">Loading knowledge items...</p>;
  }

  if (!items.length) {
    return <div className="mu-empty" style={{ minHeight: 80 }}>No Knowledge Base items yet. Add pasted text or a URL to begin.</div>;
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
            className="mu-saved-card"
            style={{ padding: '10px 12px' }}
          >
            <div className="mu-saved-head" style={{ alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span
                  className="mu-saved-title"
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', fontSize: 13 }}
                  title={item.title}
                >
                  {item.title || 'Untitled'}
                </span>
                <div className="mu-saved-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 3 }}>
                  <span className={`mu-chip${item.status === 'error' ? ' mu-chip--danger' : ''}`}>{item.status || 'ready'}</span>
                  {item.type && <span>{item.type.toUpperCase()}</span>}
                  <span>{item.chunkCount || 0} chunks</span>
                  <span>{formatDate(item.createdAt)}</span>
                </div>
                {item.sourceUrl && (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mu-saved-meta"
                    style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2, textDecoration: 'none' }}
                  >
                    {item.sourceUrl}
                  </a>
                )}
                {item.error && (
                  <p className="mu-notice mu-notice--danger" style={{ marginTop: 4, padding: '4px 8px', fontSize: 11, minHeight: 'unset' }}>{item.error}</p>
                )}
              </div>

              <button
                id={`kb-delete-${itemId}`}
                type="button"
                aria-label={`Delete ${item.title || 'Knowledge Base item'}`}
                title="Delete item"
                onClick={() => onDelete(item.id)}
                disabled={deleting}
                className="mu-btn-outline mu-btn-outline--danger"
                style={{ minHeight: 30, width: 34, padding: 0, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Trash2 size={13} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
