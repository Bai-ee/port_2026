'use client';

import React, { useState } from 'react';
import PacingStrip from './PacingStrip.jsx';

const KIND_COLORS = {
  baseline: '#6b7280',
  ramp: '#60a5fa',
  event: '#a78bfa',
  closure: '#f87171',
  special: '#fbbf24',
};

const KIND_LABELS = {
  baseline: 'BASE',
  ramp: 'RAMP',
  event: 'EVT',
  closure: 'CLOSED',
  special: 'SPECIAL',
};

function formatDay(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function groupByDay(items) {
  const map = {};
  for (const item of items || []) {
    const day = (item.scheduledAt || '').slice(0, 10);
    if (!map[day]) map[day] = [];
    map[day].push(item);
  }
  return map;
}

function getDaysInWindow(startDate, days) {
  const result = [];
  const start = new Date(startDate + 'T00:00:00Z');
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    result.push(d.toISOString().slice(0, 10));
  }
  return result;
}

function PostRow({ item, onEdit, onRegen, regenBusy, editingId, editContent, onEditChange, onSave, onCancel }) {
  const color = KIND_COLORS[item.kind] || '#888';
  const kindLabel = KIND_LABELS[item.kind] || item.kind;
  const isEditing = editingId === item.id;
  const isRegenning = regenBusy === item.id;

  return (
    <div
      id={`strategy-builder-post-row-${item.id}`}
      style={{
        padding: '8px 10px',
        background: 'var(--surface-raised)',
        borderRadius: 6,
        border: '1px solid var(--border)',
        marginBottom: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: isEditing ? 8 : 0 }}>
        {/* Kind badge */}
        <span style={{
          fontSize: 9,
          fontFamily: 'monospace',
          letterSpacing: '0.08em',
          color,
          background: `${color}18`,
          border: `1px solid ${color}40`,
          borderRadius: 4,
          padding: '1px 6px',
          flexShrink: 0,
        }}>
          {kindLabel}
        </span>

        {/* Content preview / edit */}
        {isEditing ? null : (
          <span
            onClick={() => onEdit(item.id, item.content)}
            style={{
              flex: 1,
              fontSize: 11,
              fontFamily: 'var(--font-ui)',
              color: 'var(--text-secondary)',
              cursor: 'text',
              lineHeight: 1.4,
            }}
          >
            {truncate(item.content, 60)}
          </span>
        )}

        {/* Regen button */}
        <button
          type="button"
          onClick={() => onRegen(item.id)}
          disabled={isRegenning}
          className="sb-link-btn"
          style={{ fontSize: 9, fontFamily: 'var(--font-mono)', padding: '2px 8px', cursor: isRegenning ? 'not-allowed' : 'pointer' }}
        >
          {isRegenning ? '…' : 'regen'}
        </button>
      </div>

      {/* Inline editor */}
      {isEditing && (
        <div>
          <textarea
            value={editContent}
            onChange={(e) => onEditChange(e.target.value)}
            maxLength={280}
            rows={3}
            className="sb-input"
            style={{ resize: 'vertical' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: editContent.length > 260 ? 'var(--accent)' : 'var(--text-disabled)' }}>
              {editContent.length}/280
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onCancel} className="sb-link-btn" style={{ fontSize: 10 }}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onSave(item.id)}
                disabled={editContent.length > 280 || editContent.trim().length === 0}
                className="tile-foot-rerun-btn"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const PLATFORM_LABELS = { x: 'X', instagram: 'IG', linkedin: 'LI', tiktok: 'TT' };

function TodaySection({ today, onEditToday, onPush, pushState }) {
  if (!today || !Array.isArray(today.posts) || today.posts.length === 0) return null;

  const pushLabel = pushState === 'pushing' ? '…' : pushState === 'done' ? 'Queued ✓' : pushState === 'error' ? 'Failed' : '→ Queue';

  return (
    <div id="strategy-builder-today-section" style={{
      marginBottom: 20,
      borderRadius: 8,
      border: '1px solid var(--accent, #e8d5b0)',
      background: 'color-mix(in srgb, var(--accent, #e8d5b0) 6%, var(--surface-raised))',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div id="strategy-builder-today-header" style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px 6px',
        borderBottom: '1px solid color-mix(in srgb, var(--accent, #e8d5b0) 30%, transparent)',
      }}>
        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', fontWeight: 700, color: 'var(--accent, #c9a96e)', textTransform: 'uppercase', flexShrink: 0 }}>
          TODAY · {today.date || ''}
        </span>
        {today.strategy_intent && (
          <span style={{ fontSize: 11, fontFamily: 'var(--font-ui)', color: 'var(--text-secondary)', flex: 1, lineHeight: 1.4 }}>
            {today.strategy_intent}
          </span>
        )}
        {onPush && (
          <button
            type="button"
            onClick={onPush}
            disabled={pushState === 'pushing' || pushState === 'done'}
            className="sb-link-btn"
            style={{ fontSize: 9, fontFamily: 'var(--font-mono)', flexShrink: 0, color: pushState === 'done' ? 'var(--text-disabled)' : pushState === 'error' ? '#ef4444' : 'var(--accent, #c9a96e)', letterSpacing: '0.06em' }}
          >
            {pushLabel}
          </button>
        )}
      </div>

      {/* Signals used */}
      {(today.signals_used || []).length > 0 && (
        <div id="strategy-builder-today-signals" style={{ padding: '5px 12px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {today.signals_used.map((s, i) => (
            <span key={i} style={{
              fontSize: 9,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.06em',
              color: 'var(--text-disabled)',
              background: 'color-mix(in srgb, var(--accent, #e8d5b0) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent, #e8d5b0) 25%, transparent)',
              borderRadius: 3,
              padding: '1px 6px',
            }}>
              {s}
            </span>
          ))}
        </div>
      )}

      {/* Posts */}
      <div id="strategy-builder-today-posts" style={{ padding: '6px 12px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {today.posts.map((post, i) => (
          <div key={post.id || i} id={`strategy-builder-today-post-${post.id || i}`} style={{
            padding: '7px 10px',
            background: 'var(--surface-raised)',
            borderRadius: 6,
            border: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              {post.platform_hint && (
                <span style={{
                  fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
                  color: 'var(--accent, #c9a96e)',
                  background: 'color-mix(in srgb, var(--accent, #e8d5b0) 14%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--accent, #e8d5b0) 30%, transparent)',
                  borderRadius: 3, padding: '1px 5px', flexShrink: 0,
                }}>
                  {PLATFORM_LABELS[post.platform_hint] || post.platform_hint.toUpperCase()}
                </span>
              )}
              {post.signal_used && (
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-disabled)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  ← {post.signal_used}
                </span>
              )}
              <button
                type="button"
                onClick={() => onEditToday(post.id || String(i), post.content)}
                className="sb-link-btn"
                style={{ fontSize: 9, fontFamily: 'var(--font-mono)', padding: '2px 8px', flexShrink: 0 }}
              >
                edit
              </button>
            </div>
            <div style={{ fontSize: 12, fontFamily: 'var(--font-ui)', color: 'var(--text-primary)', lineHeight: 1.45 }}>
              {post.content}
            </div>
            {post.rationale && (
              <div style={{ fontSize: 10, fontFamily: 'var(--font-ui)', color: 'var(--text-disabled)', marginTop: 4, fontStyle: 'italic' }}>
                {post.rationale}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * @param {{
 *   plan: import('../../../features/strategy-builder/schemas.js').PostPlan|null,
 *   config: Object,
 *   getIdToken: Function,
 *   onPlanChange: Function,
 *   onRequestGenerate?: Function,
 * }} props
 */
export default function CalendarPane({ plan, config, getIdToken, onPlanChange, onRequestGenerate, onPush, onOpenSocialPosting }) {
  const [view, setView] = useState('monthly');
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [regenBusy, setRegenBusy] = useState(null);
  const [todayEditingId, setTodayEditingId] = useState(null);
  const [todayEditContent, setTodayEditContent] = useState('');
  // day push state: { [day]: 'pushing' | 'done' | 'error' }
  const [dayPushState, setDayPushState] = useState({});
  const [todayPushState, setTodayPushState] = useState(null);

  if (!plan) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, fontFamily: 'var(--font-ui)' }}>
          Generate a strategy in the Inputs tab.
        </div>
        {onRequestGenerate && (
          <button type="button" onClick={onRequestGenerate} className="tile-foot-rerun-btn">
            Go to Inputs
          </button>
        )}
      </div>
    );
  }

  const now = new Date().toISOString();
  const byDay = groupByDay(plan.items);
  const sortedItems = [...(plan.items || [])].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  function handleEdit(id, content) {
    setEditingId(id);
    setEditContent(content);
  }

  function handleSave(id) {
    onPlanChange({
      ...plan,
      items: plan.items.map((i) => i.id === id ? { ...i, content: editContent } : i),
    });
    setEditingId(null);
    setEditContent('');
  }

  function handleCancel() {
    setEditingId(null);
    setEditContent('');
  }

  async function handleRegen(itemId) {
    setRegenBusy(itemId);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/dashboard/strategy-builder/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ config, regenItemId: itemId, currentPlan: plan }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.plan) {
        // Swap only the regenerated item
        const newItem = data.plan.items?.find((i) => i.id === itemId);
        if (newItem) {
          onPlanChange({
            ...plan,
            items: plan.items.map((i) => i.id === itemId ? newItem : i),
          });
        } else {
          onPlanChange(data.plan);
        }
      }
    } catch {
      // silent fail on regen
    } finally {
      setRegenBusy(null);
    }
  }

  function handleEditToday(id, content) {
    setTodayEditingId(id);
    setTodayEditContent(content);
  }

  function handleSaveToday(postId) {
    if (!plan.today) return;
    onPlanChange({
      ...plan,
      today: {
        ...plan.today,
        posts: plan.today.posts.map((p, i) =>
          (p.id || String(i)) === postId ? { ...p, content: todayEditContent } : p
        ),
      },
    });
    setTodayEditingId(null);
    setTodayEditContent('');
  }

  async function handlePushDay(day, items) {
    if (!onPush || !items?.length) return;
    setDayPushState((s) => ({ ...s, [day]: 'pushing' }));
    const result = await onPush(items);
    const state = result.failed?.length && !result.scheduled ? 'error' : 'done';
    setDayPushState((s) => ({ ...s, [day]: state }));
    if (state === 'done' && onOpenSocialPosting) onOpenSocialPosting();
  }

  async function handlePushToday() {
    if (!onPush || !plan?.today?.posts?.length) return;
    setTodayPushState('pushing');
    const now = new Date().toISOString();
    // Convert today's posts to items shape so push route accepts them
    const items = plan.today.posts.map((p, i) => ({
      id: p.id || `today-${i}`,
      scheduledAt: now,
      content: p.content || '',
      hashtags: [],
      mediaHint: p.mediaHint || '',
      kind: 'special',
      anchorId: null,
      rationale: p.rationale || p.signal_used || '',
      confidence: 0.9,
    }));
    const result = await onPush(items);
    const state = result.failed?.length && !result.scheduled ? 'error' : 'done';
    setTodayPushState(state);
    if (state === 'done' && onOpenSocialPosting) onOpenSocialPosting();
  }

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Today strategy — always shown at top when present */}
      {plan.today && (
        todayEditingId ? (
          <div id="strategy-builder-today-edit-shell" style={{
            marginBottom: 20,
            borderRadius: 8,
            border: '1px solid var(--accent, #e8d5b0)',
            background: 'color-mix(in srgb, var(--accent, #e8d5b0) 6%, var(--surface-raised))',
            padding: '10px 12px',
          }}>
            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', fontWeight: 700, color: 'var(--accent, #c9a96e)', textTransform: 'uppercase', marginBottom: 8 }}>
              TODAY · EDITING
            </div>
            <textarea
              value={todayEditContent}
              onChange={(e) => setTodayEditContent(e.target.value)}
              maxLength={280}
              rows={3}
              className="sb-input"
              style={{ resize: 'vertical' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: todayEditContent.length > 260 ? 'var(--accent)' : 'var(--text-disabled)' }}>
                {todayEditContent.length}/280
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => { setTodayEditingId(null); setTodayEditContent(''); }} className="sb-link-btn" style={{ fontSize: 10 }}>Cancel</button>
                <button
                  type="button"
                  onClick={() => handleSaveToday(todayEditingId)}
                  disabled={todayEditContent.length > 280 || todayEditContent.trim().length === 0}
                  className="tile-foot-rerun-btn"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        ) : (
          <TodaySection today={plan.today} onEditToday={handleEditToday} onPush={handlePushToday} pushState={todayPushState} />
        )
      )}

      {/* Pacing strip */}
      <PacingStrip anchors={plan.anchors || []} now={now} />

      {/* View toggles — design-system segmented control */}
      <div id="strategy-builder-view-toggles" className="sb-seg" style={{ marginBottom: 16, alignItems: 'center' }}>
        <button type="button" className={`sb-seg-btn${view === 'daily' ? ' is-active' : ''}`} onClick={() => setView('daily')}>DAILY</button>
        <button type="button" className={`sb-seg-btn${view === 'weekly' ? ' is-active' : ''}`} onClick={() => setView('weekly')}>WEEKLY</button>
        <button type="button" className={`sb-seg-btn${view === 'monthly' ? ' is-active' : ''}`} onClick={() => setView('monthly')}>30-DAY</button>
        <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-disabled)', flex: '0 0 auto', paddingLeft: 10 }}>
          {plan.items?.length || 0} posts
        </span>
      </div>

      {/* Monthly (30-day grid) */}
      {view === 'monthly' && (() => {
        const startDate = (plan.items?.[0]?.scheduledAt || new Date().toISOString()).slice(0, 10);
        const days = getDaysInWindow(startDate, config?.days || 30);

        return (
          <div id="strategy-builder-calendar-grid">
            {days.map((day) => {
              const dayItems = byDay[day] || [];
              if (dayItems.length === 0) return null;
              const ps = dayPushState[day];
              return (
                <div key={day} style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, gap: 8 }}>
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', flex: 1 }}>
                      {formatDay(day)}
                    </span>
                    {onPush && (
                      <button
                        type="button"
                        onClick={() => handlePushDay(day, dayItems)}
                        disabled={ps === 'pushing' || ps === 'done'}
                        className="sb-link-btn"
                        style={{ fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', color: ps === 'done' ? 'var(--text-disabled)' : ps === 'error' ? '#ef4444' : 'var(--text-secondary)' }}
                      >
                        {ps === 'pushing' ? '…' : ps === 'done' ? '✓ queued' : ps === 'error' ? 'failed' : '→ queue'}
                      </button>
                    )}
                  </div>
                  {dayItems.map((item) => (
                    <PostRow
                      key={item.id}
                      item={item}
                      onEdit={handleEdit}
                      onRegen={handleRegen}
                      regenBusy={regenBusy}
                      editingId={editingId}
                      editContent={editContent}
                      onEditChange={setEditContent}
                      onSave={handleSave}
                      onCancel={handleCancel}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Weekly view */}
      {view === 'weekly' && (() => {
        const startDate = (plan.items?.[0]?.scheduledAt || new Date().toISOString()).slice(0, 10);
        const days = getDaysInWindow(startDate, 7);
        return (
          <div id="strategy-builder-weekly-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
            {days.map((day) => {
              const dayItems = byDay[day] || [];
              return (
                <div key={day} style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 4 }}>
                    {formatDay(day)}
                  </div>
                  {dayItems.length === 0
                    ? <div style={{ fontSize: 9, color: 'var(--text-disabled)' }}>—</div>
                    : dayItems.map((item) => (
                        <div key={item.id} style={{
                          fontSize: 9,
                          padding: '4px 6px',
                          background: `${KIND_COLORS[item.kind] || '#888'}18`,
                          border: `1px solid ${KIND_COLORS[item.kind] || '#888'}30`,
                          borderRadius: 4,
                          color: 'var(--text-secondary)',
                          fontFamily: 'var(--font-ui)',
                          marginBottom: 4,
                          cursor: 'pointer',
                        }}
                        onClick={() => handleEdit(item.id, item.content)}
                        >
                          {KIND_LABELS[item.kind]} · {truncate(item.content, 30)}
                        </div>
                      ))
                  }
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Daily view — flat sorted list */}
      {view === 'daily' && (
        <div id="strategy-builder-daily-list">
          {sortedItems.map((item) => (
            <PostRow
              key={item.id}
              item={item}
              onEdit={handleEdit}
              onRegen={handleRegen}
              regenBusy={regenBusy}
              editingId={editingId}
              editContent={editContent}
              onEditChange={setEditContent}
              onSave={handleSave}
              onCancel={handleCancel}
            />
          ))}
        </div>
      )}
    </div>
  );
}
