'use client';

import React from 'react';
import { BarChart3, Bookmark, Heart, MessageCircle, Play, Repeat2, Share, X } from 'lucide-react';

// XPostPreview — "what this post would look like on X", opened from the calendar day view's VIEW POST.
// Pure presentation over the calendar row (text, media, quoted post) plus the account identity the host
// passes in (client name + connected @handle; no avatar image without a paid X API read, so an initial
// stands in). Character count is approximate (plain length; X counts each link as 23).

const X_LIMIT = 280;

function whenLabel(date, time) {
  if (!date) return time || '';
  const d = new Date(`${date}T12:00:00`);
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (!time) return day;
  const [h, m] = String(time).split(':').map(Number);
  if (!Number.isFinite(h)) return `${time} · ${day}`;
  const hr = ((h + 11) % 12) + 1;
  return `${hr}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'} · ${day}`;
}

export default function XPostPreview({ row, date, identity, onClose, onEdit }) {
  const text = String(row?.content || row?.text || row?.title || '').trim();
  const requote = row?.kind === 'requote';
  const quotedText = requote ? String(row?.quotedText || row?.text || '') : '';
  // A requote row's own text is the quoted post; the reply copy is not written yet.
  const ownText = requote ? '' : text;
  const len = ownText.length;
  const name = identity?.name || 'Your account';
  const handle = identity?.handle ? `@${String(identity.handle).replace(/^@/, '')}` : '@handle';
  const initial = name.trim().charAt(0).toUpperCase() || 'X';
  const video = row?.mediaType === 'video' || /\.(mp4|mov|webm)(\?|$)/i.test(row?.mediaUrl || '');
  const still = video ? (row?.posterUrl || row?.thumbUrl) : (row?.mediaUrl || row?.thumbUrl);

  return (
    <div id="x-post-preview-overlay" role="dialog" aria-modal="true" aria-labelledby="x-post-preview-title" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div id="x-post-preview-card" onClick={(e) => e.stopPropagation()}>
        <div id="x-post-preview-header">
          <span id="x-post-preview-title" className="xpp-caps">X PREVIEW{row?.proposed ? ' · PROPOSED TIME' : ''}</span>
          <button type="button" id="x-post-preview-close" onClick={onClose} aria-label="Close preview"><X size={16} strokeWidth={2} /></button>
        </div>

        <article id="x-post-preview-post" aria-label="Post preview">
          <div id="x-post-preview-avatar" aria-hidden="true">{initial}</div>
          <div id="x-post-preview-main">
            <div id="x-post-preview-identity">
              <span id="x-post-preview-name">{name}</span>
              <span id="x-post-preview-handle">{handle}</span>
            </div>
            {ownText ? <p id="x-post-preview-text">{ownText}</p> : null}
            {requote && !ownText ? <p id="x-post-preview-text-empty" className="xpp-caps">YOUR QUOTE TEXT GOES HERE</p> : null}
            {still ? (
              <div id="x-post-preview-media" data-video={video ? 'true' : 'false'}>
                <img src={still} alt="" />
                {video ? <span id="x-post-preview-play" aria-hidden="true"><Play size={22} strokeWidth={2} fill="currentColor" /></span> : null}
              </div>
            ) : null}
            {requote ? (
              <div id="x-post-preview-quoted">
                <div className="xpp-quoted-identity">
                  <span className="xpp-quoted-avatar" aria-hidden="true">{String(row?.quotedHandle || row?.handle || '?').charAt(0).toUpperCase()}</span>
                  <span className="xpp-quoted-handle">@{String(row?.quotedHandle || row?.handle || 'unknown').replace(/^@/, '')}</span>
                </div>
                <p className="xpp-quoted-text">{quotedText}</p>
              </div>
            ) : null}
            <div id="x-post-preview-time">{whenLabel(date, row?.time)}</div>
            <div id="x-post-preview-actions" aria-hidden="true">
              <MessageCircle size={17} strokeWidth={1.75} />
              <Repeat2 size={18} strokeWidth={1.75} />
              <Heart size={17} strokeWidth={1.75} />
              <BarChart3 size={17} strokeWidth={1.75} />
              <span className="xpp-actions-right"><Bookmark size={17} strokeWidth={1.75} /><Share size={17} strokeWidth={1.75} /></span>
            </div>
          </div>
        </article>

        <div id="x-post-preview-footer">
          <span id="x-post-preview-count" className="xpp-caps" data-over={len > X_LIMIT ? 'true' : 'false'}>
            {requote ? 'QUOTE POST' : `≈${len} / ${X_LIMIT}`}
          </span>
          {typeof onEdit === 'function' ? (
            <button type="button" id="x-post-preview-edit-btn" onClick={onEdit}>Edit post</button>
          ) : null}
        </div>
      </div>

      <style>{`
        #x-post-preview-overlay { position: fixed; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center; padding: 20px; background: color-mix(in srgb, var(--t-surface) 55%, transparent); }
        #x-post-preview-card { width: 100%; max-width: 560px; max-height: 100%; overflow-y: auto; display: flex; flex-direction: column; border: 1px solid var(--t-border-subtle); border-radius: 16px; background: var(--t-surface); box-shadow: 0 1px 0 var(--t-border-subtle), inset 0 1px 0 var(--t-glass-highlight), 0px 15px 30px rgba(0, 0, 0, 0.2); color: var(--t-text); }
        #x-post-preview-overlay .xpp-caps { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--t-text-secondary); }
        #x-post-preview-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--t-border-faint); }
        #x-post-preview-close { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 1px solid var(--t-border-faint); border-radius: 999px; background: transparent; color: var(--t-text-secondary); cursor: pointer; }
        #x-post-preview-close:hover { color: var(--t-text-strong); border-color: var(--t-control-border-strong); }
        /* Post body: X's own proportions — 40px avatar, 15px text, 16px media radius. */
        #x-post-preview-post { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 12px; padding: 14px 16px 6px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        #x-post-preview-avatar { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; background: var(--t-text-strong); color: var(--t-surface); font-weight: 700; font-size: 16px; }
        #x-post-preview-main { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
        #x-post-preview-identity { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-size: 15px; }
        #x-post-preview-name { font-weight: 700; color: var(--t-text-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        #x-post-preview-handle { color: var(--t-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        #x-post-preview-text { margin: 0; font-size: 15px; line-height: 1.35; color: var(--t-text-strong); white-space: pre-wrap; overflow-wrap: anywhere; }
        #x-post-preview-text-empty { margin: 0; }
        #x-post-preview-media { position: relative; margin-top: 6px; overflow: hidden; border: 1px solid var(--t-border-faint); border-radius: 16px; background: var(--t-raised); }
        #x-post-preview-media img { display: block; width: 100%; max-height: 420px; object-fit: cover; }
        #x-post-preview-play { position: absolute; left: 50%; top: 50%; display: inline-flex; align-items: center; justify-content: center; width: 52px; height: 52px; margin: -26px 0 0 -26px; border-radius: 50%; background: color-mix(in srgb, var(--t-text-strong) 85%, transparent); color: var(--t-surface); }
        #x-post-preview-quoted { margin-top: 6px; padding: 10px 12px; border: 1px solid var(--t-border-subtle); border-radius: 16px; }
        #x-post-preview-quoted .xpp-quoted-identity { display: flex; align-items: center; gap: 6px; font-size: 14px; }
        #x-post-preview-quoted .xpp-quoted-avatar { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: var(--t-raised); color: var(--t-text-secondary); font-size: 11px; font-weight: 700; }
        #x-post-preview-quoted .xpp-quoted-handle { color: var(--t-text-secondary); }
        #x-post-preview-quoted .xpp-quoted-text { margin: 6px 0 0; font-size: 14px; line-height: 1.35; color: var(--t-text); white-space: pre-wrap; overflow-wrap: anywhere; }
        #x-post-preview-time { padding: 6px 0; font-size: 14px; color: var(--t-text-secondary); border-bottom: 1px solid var(--t-border-faint); }
        #x-post-preview-actions { display: flex; align-items: center; gap: 28px; padding: 8px 0 4px; color: var(--t-text-secondary); }
        #x-post-preview-actions .xpp-actions-right { display: inline-flex; gap: 16px; margin-left: auto; }
        #x-post-preview-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--t-border-faint); }
        #x-post-preview-count[data-over="true"] { color: var(--t-danger); }
        #x-post-preview-edit-btn { min-height: 34px; padding: 0 16px; border: 1px solid var(--t-border-faint); border-radius: 999px; background: transparent; color: var(--t-text-strong); font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; }
        #x-post-preview-edit-btn:hover { border-color: var(--t-control-border-strong); }
        @media (max-width: 480px) {
          #x-post-preview-overlay { padding: var(--mobile-gutter, 8px); align-items: flex-start; }
          #x-post-preview-actions { gap: 20px; }
        }
      `}</style>
    </div>
  );
}
