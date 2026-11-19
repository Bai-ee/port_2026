'use client';

import React, { useState } from 'react';
import { ChevronRight, Trash2 } from 'lucide-react';

import { BRAIN_ROLE_LABELS, groupBrainItems } from '../../../features/knowledge-base/brain-layout.js';

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

function fileNameOf(item) {
  const path = String(item.brainPath || '');
  return path.split('/').pop() || item.title || 'Untitled';
}

function ItemRow({ item, deletingId, onDelete }) {
  const itemId = safeId(item.id);
  const deleting = deletingId === item.id;
  const name = fileNameOf(item);
  const folder = String(item.brainPath || '').split('/').slice(0, -1).join('/');
  return (
    <div id={`kb-item-${itemId}`} className="mu-saved-card" style={{ padding: '10px 12px' }}>
      <div className="mu-saved-head" style={{ alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span
            className="mu-saved-title"
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', fontSize: 13 }}
            title={item.brainPath || item.title}
          >
            {name}
          </span>
          {item.title && item.title !== name && (
            <span className="mu-saved-meta" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
              {item.title}
            </span>
          )}
          <div className="mu-saved-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 3 }}>
            <span className="mu-chip">{BRAIN_ROLE_LABELS[item.brainRole] || 'Source'}</span>
            {item.status && item.status !== 'ready' && (
              <span className={`mu-chip${item.status === 'error' ? ' mu-chip--danger' : ''}`}>{item.status}</span>
            )}
            {Array.isArray(item.sourceIds) && item.sourceIds.length > 0 && <span>{item.sourceIds.join(', ')}</span>}
            {item.brainDate && <span>{item.brainDate}</span>}
            <span>{item.chunkCount || 0} chunks</span>
            <span>added {formatDate(item.createdAt)}</span>
            {item.sha256 && <span title={`sha256 ${item.sha256}`}>#{item.sha256.slice(0, 8)}</span>}
            {item.legacy && <span title="Added before the brain layout; filed under sources/ by name">legacy</span>}
            {folder && item.brainRole === 'source' && folder !== 'sources' && <span>{folder}/</span>}
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
          aria-label={`Delete ${name}`}
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
}

export default function ItemsList({ items, loading, deletingId, onDelete }) {
  // Version snapshots start collapsed; current folders start open.
  const [openGroups, setOpenGroups] = useState({});

  if (loading) {
    return <p className="mu-notice">Loading knowledge items...</p>;
  }

  if (!items.length) {
    return <div className="mu-empty" style={{ minHeight: 80 }}>No Source Library items yet. Drop a brain folder, documents, pasted text, or a URL to begin.</div>;
  }

  const groups = groupBrainItems(items);

  return (
    <div id="kb-items-list" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {groups.map((group) => {
        const groupId = safeId(group.id);
        const isOpen = openGroups[group.id] ?? !group.id.startsWith('version-');
        return (
          <section key={group.id} id={`kb-brain-group-${groupId}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              id={`kb-brain-group-toggle-${groupId}`}
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenGroups((prev) => ({ ...prev, [group.id]: !isOpen }))}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: 0,
                border: 0,
                background: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.06em',
                color: 'var(--text-secondary)',
                textAlign: 'left',
              }}
            >
              <ChevronRight
                size={12}
                strokeWidth={2}
                aria-hidden="true"
                style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 150ms ease-out' }}
              />
              <span>{group.label}</span>
              <span style={{ color: 'var(--text-disabled)' }}>{group.items.length}</span>
            </button>
            {isOpen && group.items.map((item) => (
              <ItemRow key={item.id} item={item} deletingId={deletingId} onDelete={onDelete} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
