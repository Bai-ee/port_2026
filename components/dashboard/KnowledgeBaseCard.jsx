'use client';

import React, { useCallback, useEffect, useState } from 'react';

import AddItemPanel from './knowledge-base/AddItemPanel.jsx';
import ItemsList from './knowledge-base/ItemsList.jsx';

const TABS = [
  { id: 'text', label: 'TEXT' },
  { id: 'url', label: 'URL' },
  { id: 'upload', label: 'UPLOAD' },
];

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function HighlightText({ text, terms = [] }) {
  const value = String(text || '');
  const cleanTerms = [...new Set((Array.isArray(terms) ? terms : []).map((term) => String(term || '').trim()).filter(Boolean))].slice(0, 8);
  if (!cleanTerms.length || !value) return value;

  const pattern = new RegExp(`(${cleanTerms.map(escapeRegExp).join('|')})`, 'ig');
  const parts = value.split(pattern);
  return parts.map((part, index) => {
    const matched = cleanTerms.some((term) => term.toLowerCase() === part.toLowerCase());
    return matched ? <mark key={`${part}-${index}`} className="kb-hit-mark">{part}</mark> : <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
  });
}

function sourceTypeLabel(chunk) {
  const type = String(chunk?.sourceType || chunk?.type || '').toUpperCase();
  if (type === 'PDF') return 'PDF';
  if (type === 'DOCX') return 'DOCX';
  if (type === 'URL') return 'URL';
  if (type === 'TEXT') return 'TEXT';
  return type || 'SOURCE';
}

export default function KnowledgeBaseCard({ getIdToken }) {
  const [activeTab, setActiveTab] = useState('text');
  const [items, setItems] = useState([]);
  const [limits, setLimits] = useState({ maxItems: 100, remaining: 100 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [chatQuestion, setChatQuestion] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatAnswer, setChatAnswer] = useState('');
  const [chatSources, setChatSources] = useState([]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = await getIdToken();
      const res = await fetch('/api/dashboard/knowledge-base/items', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setItems(Array.isArray(data.items) ? data.items : []);
      setLimits(data.limits || { maxItems: 100, remaining: 0 });
    } catch (err) {
      setError(err.message || 'Could not load Knowledge Base items.');
    } finally {
      setLoading(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  async function handleSubmit(payload) {
    setBusy(true);
    setError('');
    try {
      const token = await getIdToken();
      let res;
      if (activeTab === 'upload') {
        const formData = new FormData();
        formData.append('file', payload.file);
        if (payload.title) formData.append('title', payload.title);
        res = await fetch('/api/dashboard/knowledge-base/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
      } else {
        const endpoint = activeTab === 'url'
          ? '/api/dashboard/knowledge-base/ingest-url'
          : '/api/dashboard/knowledge-base/ingest-text';
        const body = activeTab === 'url'
          ? { title: payload.title, url: payload.url }
          : { title: payload.title, text: payload.text };
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      await loadItems();
    } catch (err) {
      setError(err.message || 'Could not add Knowledge Base item.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(itemId) {
    if (!itemId || deletingId) return;
    if (!window.confirm('Delete this Knowledge Base item? This removes all its chunks and any uploaded file.')) return;
    setDeletingId(itemId);
    setError('');
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/dashboard/knowledge-base/items/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      await loadItems();
    } catch (err) {
      setError(err.message || 'Could not delete Knowledge Base item.');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSearch(event) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query || searching) return;
    setSearching(true);
    setError('');
    try {
      const token = await getIdToken();
      const res = await fetch('/api/dashboard/knowledge-base/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query, topK: 8 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setSearchResults(Array.isArray(data.chunks) ? data.chunks : []);
    } catch (err) {
      setSearchResults([]);
      setError(err.message || 'Knowledge Base search failed.');
    } finally {
      setSearching(false);
    }
  }

  async function handleChat(event) {
    event.preventDefault();
    const question = chatQuestion.trim();
    if (!question || chatBusy) return;
    setChatBusy(true);
    setError('');
    try {
      const token = await getIdToken();
      const res = await fetch('/api/dashboard/knowledge-base/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setChatAnswer(data.answer || '');
      setChatSources(Array.isArray(data.chunks) ? data.chunks : []);
    } catch (err) {
      setChatAnswer('');
      setChatSources([]);
      setError(err.message || 'Knowledge Base chat failed.');
    } finally {
      setChatBusy(false);
    }
  }

  const itemCount = items.length;
  const approachingLimit = limits.remaining <= 10;

  return (
    <div
      id="kb-card-shell"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        height: '100%',
        minHeight: 0,
        overflowY: 'auto',
        paddingRight: 6,
      }}
    >
      <div id="kb-summary-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '10px 12px', border: '1px solid rgba(42,36,32,0.1)', borderRadius: 8, background: 'rgba(255,255,255,0.6)' }}>
          <span className="mu-label">Items</span>
          <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 600 }}>{itemCount}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '10px 12px', border: '1px solid rgba(42,36,32,0.1)', borderRadius: 8, background: 'rgba(255,255,255,0.6)' }}>
          <span className="mu-label">Remaining</span>
          <span style={{ color: approachingLimit ? '#e67e22' : 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 600 }}>
            {limits.remaining ?? 0}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '10px 12px', border: '1px solid rgba(42,36,32,0.1)', borderRadius: 8, background: 'rgba(255,255,255,0.6)' }}>
          <span className="mu-label">Retrieval</span>
          <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            OpenAI
          </span>
        </div>
      </div>

      {error && (
        <p id="kb-error-banner" className="mu-notice mu-notice--danger">{error}</p>
      )}

      {approachingLimit && (
        <p id="kb-limit-warning" className="mu-notice">
          Knowledge Base is approaching the {limits.maxItems || 100}-item v1 limit.
        </p>
      )}

      <div id="kb-tab-bar" className="tile-detail-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`kb-tab-${tab.id}`}
            type="button"
            className={`tile-detail-tab${activeTab === tab.id ? ' tile-detail-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div id="kb-workspace">
        <section id="kb-add-section" className="kb-panel">
          <div className="kb-panel-head">
            <span className="mu-label">Add Knowledge</span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{activeTab === 'upload' ? 'Documents are extracted, chunked, and embedded.' : activeTab === 'url' ? 'Imports readable page text from one URL.' : 'Paste client-owned context directly.'}</span>
          </div>
          <AddItemPanel mode={activeTab} busy={busy} onSubmit={handleSubmit} />
        </section>

        <section id="kb-list-section" className="kb-panel">
          <div className="kb-panel-head-row">
            <div className="kb-panel-head">
              <span className="mu-label">Uploaded Items</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{itemCount} saved · delete removes chunks and stored files.</span>
            </div>
            <button type="button" className="mu-btn-outline" style={{ minHeight: 30, padding: '0 10px', fontSize: 11 }} onClick={loadItems} disabled={loading || busy}>
              Refresh
            </button>
          </div>
          <ItemsList items={items} loading={loading} deletingId={deletingId} onDelete={handleDelete} />
        </section>
      </div>

      <form id="kb-chat-panel" className="kb-panel" onSubmit={handleChat}>
        <div className="kb-panel-head-row">
          <div className="kb-panel-head">
            <span className="mu-label">Ask Brain</span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>Answers use retrieved chunks and cite the source list below.</span>
          </div>
          <span className="kb-model-chip">Haiku</span>
        </div>
        <div className="kb-chat-row">
          <input
            id="kb-chat-input"
            type="text"
            value={chatQuestion}
            onChange={(event) => setChatQuestion(event.target.value)}
            placeholder="Ask a question about the uploaded knowledge"
            className="mu-input"
          />
          <button
            id="kb-chat-submit"
            type="submit"
            disabled={!chatQuestion.trim() || chatBusy}
            className="mu-btn-update"
            style={{ minHeight: 46, padding: '0 18px', fontSize: 13 }}
          >
            {chatBusy ? 'Thinking...' : 'Ask'}
          </button>
        </div>
        {chatAnswer && (
          <div id="kb-chat-answer">
            <span className="mu-label">Answer</span>
            <p>{chatAnswer}</p>
            {chatSources.length > 0 && (
              <div className="kb-citation-row">
                {chatSources.slice(0, 5).map((chunk, index) => (
                  <span key={chunk.id || index} className="kb-citation-chip">[{index + 1}] {chunk.sourceTitle}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </form>

      <form id="kb-search-panel" onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="mu-label">Semantic Search</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="kb-search-input"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search client knowledge"
            className="mu-input"
            style={{ flex: 1 }}
          />
          <button
            id="kb-search-submit"
            type="submit"
            disabled={!searchQuery.trim() || searching}
            className="mu-btn-update"
            style={{ flex: '0 0 auto', minHeight: 46, padding: '0 18px', fontSize: 13 }}
          >
            {searching ? 'Searching...' : 'Search'}
          </button>
        </div>
        {searchResults.length > 0 && (
          <div id="kb-search-results">
            {searchResults.map((chunk, index) => (
              <article key={chunk.id || `${chunk.itemId}-${index}`} id={`kb-search-result-${index}`} className="kb-result-card">
                <header className="kb-result-head">
                  <div className="kb-result-title-block">
                    <span className="kb-result-rank">[{index + 1}] {chunk.relevanceLabel || 'semantic match'}</span>
                    <h4>{chunk.sectionTitle || chunk.sourceTitle || 'Knowledge excerpt'}</h4>
                    <div className="kb-result-source-line">
                      <span>{sourceTypeLabel(chunk)}</span>
                      <span>{chunk.sourceTitle || 'Knowledge source'}</span>
                      {Number.isFinite(Number(chunk.position)) && <span>Chunk {Number(chunk.position) + 1}</span>}
                    </div>
                  </div>
                  {typeof chunk.distance === 'number' && (
                    <span className="kb-distance">{chunk.distance.toFixed(3)}</span>
                  )}
                </header>

                {chunk.matchedTerms?.length > 0 && (
                  <div className="kb-term-row" aria-label="Lexical overlap">
                    {chunk.matchedTerms.map((term) => <span key={term} className="kb-term-chip">{term}</span>)}
                  </div>
                )}

                <p className="kb-result-excerpt">
                  <HighlightText text={chunk.excerpt || chunk.text} terms={chunk.matchedTerms} />
                </p>

                <footer className="kb-result-foot">
                  <span>Why it matched: semantic vector search ranked this excerpt near your query{chunk.matchedTerms?.length ? `, with direct overlap on ${chunk.matchedTerms.slice(0, 4).join(', ')}` : ''}.</span>
                  {chunk.sourceHref && (
                    <a href={chunk.sourceHref} target="_blank" rel="noopener noreferrer">
                      Open source
                    </a>
                  )}
                </footer>
              </article>
            ))}
          </div>
        )}
      </form>

      <style jsx>{`
        #kb-workspace {
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(280px, 0.95fr);
          gap: 12px;
          align-items: start;
        }
        .kb-panel {
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-width: 0;
          padding: 12px;
          border: 1px solid var(--border-visible);
          border-radius: 8px;
          background: rgba(255,255,255,0.45);
        }
        .kb-panel-head {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }
        .kb-panel-head-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
        }
        #kb-list-section {
          max-height: 360px;
          overflow: auto;
        }
        #kb-chat-panel {
          gap: 10px;
        }
        .kb-chat-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 8px;
        }
        .kb-model-chip,
        .kb-citation-chip,
        .kb-term-chip {
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-secondary);
          border: 1px solid var(--border-visible);
          border-radius: 999px;
          padding: 4px 8px;
          white-space: nowrap;
        }
        #kb-chat-answer {
          border: 1px solid var(--border-visible);
          border-radius: 8px;
          padding: 12px;
          background: rgba(255,255,255,0.62);
        }
        #kb-chat-answer p {
          margin: 7px 0 0;
          color: var(--text-primary);
          font-size: 13px;
          line-height: 1.6;
          white-space: pre-wrap;
        }
        .kb-citation-row,
        .kb-term-row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 8px;
        }
        #kb-search-results {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .kb-result-card {
          display: flex;
          flex-direction: column;
          gap: 9px;
          border: 1px solid var(--border-visible);
          border-radius: 8px;
          padding: 12px;
          background: rgba(255,255,255,0.58);
        }
        .kb-result-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
        }
        .kb-result-title-block {
          min-width: 0;
        }
        .kb-result-rank {
          display: block;
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-secondary);
          margin-bottom: 4px;
        }
        .kb-result-card h4 {
          margin: 0;
          color: var(--text-primary);
          font-size: 16px;
          line-height: 1.25;
        }
        .kb-result-source-line {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 6px;
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-secondary);
        }
        .kb-distance {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-secondary);
          border: 1px solid var(--border-visible);
          border-radius: 999px;
          padding: 4px 8px;
        }
        .kb-result-excerpt {
          margin: 0;
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.55;
        }
        .kb-result-foot {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          border-top: 1px solid var(--border);
          padding-top: 8px;
          font-size: 11px;
          line-height: 1.45;
          color: var(--text-disabled);
        }
        .kb-result-foot a {
          flex-shrink: 0;
          font-family: var(--font-mono);
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-primary);
          text-decoration: none;
          border: 1px solid var(--border-visible);
          border-radius: 4px;
          padding: 5px 8px;
        }
        :global(.kb-hit-mark) {
          background: rgba(74, 222, 128, 0.22);
          color: var(--text-primary);
          border-radius: 3px;
          padding: 0 2px;
        }
        @media (max-width: 900px) {
          #kb-workspace {
            grid-template-columns: 1fr;
          }
          #kb-list-section {
            max-height: none;
          }
          .kb-chat-row {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
