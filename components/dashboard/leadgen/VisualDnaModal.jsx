'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Images, Plus, X, Loader2, CheckCircle2 } from 'lucide-react';

const DOMAINS = [
  { id: 'food', label: 'Food', hint: 'Dishes, plating, ingredients' },
  { id: 'product', label: 'Product', hint: 'Packaging, materials, use' },
  { id: 'location', label: 'Location', hint: 'Storefronts, rooms, signage' },
  { id: 'lifestyle', label: 'Lifestyle', hint: 'Moments, customers, context' },
  { id: 'people', label: 'People', hint: 'Team, wardrobe, poses' },
  { id: 'environment', label: 'Environment', hint: 'Surfaces, facility, atmosphere' },
];

const SUBJECT_PLACEHOLDERS = {
  food: 'Tacos, enchiladas, nachitos...',
  product: 'Bottle, package, bundle...',
  location: 'Dining room, storefront, patio...',
  lifestyle: 'Family dinner, pickup order...',
  people: 'Owner, staff, customer...',
  environment: 'Kitchen, prep station, workshop...',
};

function fileToPayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const [, meta = '', b64 = ''] = dataUrl.match(/^data:([^;]+);base64,(.*)$/) || [];
      resolve({ imageBase64: b64, mediaType: meta || file.type || 'image/jpeg', name: file.name });
    };
    reader.readAsDataURL(file);
  });
}

export default function VisualDnaModal({ open, prospect, getIdToken, onClose }) {
  const [domain, setDomain] = useState('food');
  const [subjectLabel, setSubjectLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState([]);
  const [visualDna, setVisualDna] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open || !prospect?.placeId) return;
    setDomain(prospect.visualDna?.domain || 'food');
    setVisualDna(prospect.visualDna || null);
    setSubjectLabel('');
    setNotes('');
    setFiles([]);
    setError('');

    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const token = await getIdToken?.();
        const res = await fetch(`/api/leadgen/visual-dna?placeId=${encodeURIComponent(prospect.placeId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setVisualDna(data.visualDna || prospect.visualDna || null);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [open, prospect, getIdToken]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const subjects = useMemo(() => (
    Array.isArray(visualDna?.subjects) ? visualDna.subjects : []
  ), [visualDna]);

  if (!open || !prospect) return null;

  async function handleSubmit() {
    if (!subjectLabel.trim() || files.length === 0) {
      setError('Add a subject and at least one image.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const images = await Promise.all(files.slice(0, 12).map(fileToPayload));
      const token = await getIdToken?.();
      const res = await fetch('/api/leadgen/visual-dna', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          placeId: prospect.placeId,
          domain,
          subjectLabel: subjectLabel.trim(),
          notes: notes.trim(),
          images,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Visual DNA failed (${res.status})`);
      setVisualDna(data.visualDna);
      setSubjectLabel('');
      setNotes('');
      setFiles([]);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div id="visual-dna-overlay" role="dialog" aria-modal="true" aria-labelledby="visual-dna-title">
      <div id="visual-dna-shell">
        <header id="visual-dna-header">
          <div id="visual-dna-title-wrap">
            <span id="visual-dna-icon"><Images size={18} strokeWidth={2.2} /></span>
            <div>
              <h2 id="visual-dna-title">Visual DNA</h2>
              <p id="visual-dna-subtitle">{prospect.name} · reference training for accurate generated imagery</p>
            </div>
          </div>
          <button type="button" id="visual-dna-close" onClick={onClose} aria-label="Close Visual DNA">
            <X size={17} strokeWidth={2.2} />
          </button>
        </header>

        <div id="visual-dna-body">
          <section id="visual-dna-builder">
            <div className="visual-dna-section-head">
              <span>Domain</span>
              <small>Choose what the references should control.</small>
            </div>
            <div id="visual-dna-domain-grid">
              {DOMAINS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`visual-dna-domain${domain === d.id ? ' visual-dna-domain--active' : ''}`}
                  onClick={() => setDomain(d.id)}
                >
                  <span>{d.label}</span>
                  <small>{d.hint}</small>
                </button>
              ))}
            </div>

            <div className="visual-dna-section-head">
              <span>Subject</span>
              <small>Food can be split into tacos, enchiladas, nachitos, and more.</small>
            </div>
            <label className="visual-dna-field">
              <span>Subject name</span>
              <input
                value={subjectLabel}
                onChange={(e) => setSubjectLabel(e.target.value)}
                placeholder={SUBJECT_PLACEHOLDERS[domain]}
                disabled={saving}
              />
            </label>
            <label className="visual-dna-field">
              <span>Operator notes</span>
              <textarea
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add specifics the images may not show: house salsa is green, portions are generous, avoid glossy stock-food styling..."
                disabled={saving}
              />
            </label>

            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 12))}
            />
            <div id="visual-dna-upload-row">
              <button type="button" className="visual-dna-secondary" onClick={() => fileRef.current?.click()} disabled={saving}>
                <Plus size={14} strokeWidth={2.4} />
                <span>{files.length ? 'Change Images' : 'Choose Images'}</span>
              </button>
              <span id="visual-dna-file-count">
                {files.length ? `${files.length} image${files.length === 1 ? '' : 's'} selected` : '3-10 images recommended'}
              </span>
            </div>

            {error ? <p id="visual-dna-error">{error}</p> : null}

            <button type="button" id="visual-dna-submit" onClick={handleSubmit} disabled={saving || loading}>
              {saving ? <Loader2 size={14} strokeWidth={2.4} className="leadgen-spin" /> : <CheckCircle2 size={14} strokeWidth={2.4} />}
              <span>{saving ? 'Analyzing references...' : 'Create Subject Profile'}</span>
            </button>
          </section>

          <section id="visual-dna-profiles">
            <div className="visual-dna-section-head">
              <span>Profiles</span>
              <small>{loading ? 'Loading...' : `${subjects.length} subject${subjects.length === 1 ? '' : 's'} ready`}</small>
            </div>

            {subjects.length ? (
              <div id="visual-dna-profile-list">
                {subjects.map((s) => (
                  <article key={s.id} className="visual-dna-profile">
                    <div className="visual-dna-profile-head">
                      <div>
                        <h3>{s.label}</h3>
                        <span>{s.domain} · {s.imageCount || s.imageUrls?.length || 0} reference images</span>
                      </div>
                      <strong>{s.status || 'draft'}</strong>
                    </div>
                    {s.imageUrls?.length ? (
                      <div className="visual-dna-thumbs">
                        {s.imageUrls.slice(0, 4).map((url) => (
                          <img key={url} src={url} alt={`${s.label} reference`} loading="lazy" />
                        ))}
                      </div>
                    ) : null}
                    {s.analysis?.summary ? <p>{s.analysis.summary}</p> : null}
                    {s.promptBlock ? <pre>{s.promptBlock}</pre> : null}
                  </article>
                ))}
              </div>
            ) : (
              <div id="visual-dna-empty">
                Add the first subject profile. For a restaurant, start with one signature dish such as tacos.
              </div>
            )}
          </section>
        </div>
      </div>

      <style jsx>{`
        #visual-dna-overlay {
          position: fixed; inset: 0; z-index: 13000;
          background: rgba(9, 9, 9, 0.58);
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
        }
        #visual-dna-shell {
          width: min(1080px, 96vw); max-height: 88vh; overflow: hidden;
          background: var(--t-inset); color: var(--t-text);
          border: 1px solid color-mix(in srgb, var(--t-text) 16%, transparent);
          border-radius: 8px;
          box-shadow: 0 24px 80px rgba(0,0,0,0.34);
          display: flex; flex-direction: column;
        }
        #visual-dna-header {
          display: flex; align-items: center; justify-content: space-between;
          gap: 16px; padding: 18px 20px;
          border-bottom: 1px solid color-mix(in srgb, var(--t-text) 10%, transparent);
        }
        #visual-dna-title-wrap { display: flex; align-items: center; gap: 12px; min-width: 0; }
        #visual-dna-icon {
          width: 38px; height: 38px; border-radius: 8px;
          display: inline-flex; align-items: center; justify-content: center;
          color: var(--t-text-inverse); background: var(--t-text);
        }
        #visual-dna-title { margin: 0; font-size: 18px; line-height: 1.1; letter-spacing: 0; }
        #visual-dna-subtitle { margin: 4px 0 0; font-size: 12px; color: color-mix(in srgb, var(--t-text) 66%, transparent); }
        #visual-dna-close {
          width: 34px; height: 34px; border-radius: 7px; border: 1px solid var(--t-border-subtle);
          background: color-mix(in srgb, var(--t-surface) 45%, transparent); color: inherit; cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
        }
        #visual-dna-body {
          display: grid; grid-template-columns: minmax(320px, 0.9fr) minmax(360px, 1.1fr);
          gap: 0; min-height: 0; overflow: hidden;
        }
        #visual-dna-builder, #visual-dna-profiles {
          padding: 18px 20px; overflow-y: auto; min-height: 0;
        }
        #visual-dna-builder { border-right: 1px solid color-mix(in srgb, var(--t-text) 10%, transparent); }
        .visual-dna-section-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin: 4px 0 10px; }
        .visual-dna-section-head span { font-size: 12px; font-weight: 800; text-transform: uppercase; }
        .visual-dna-section-head small { font-size: 11px; color: color-mix(in srgb, var(--t-text) 58%, transparent); text-align: right; }
        #visual-dna-domain-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 18px; }
        .visual-dna-domain {
          text-align: left; border: 1px solid var(--t-border-subtle); border-radius: 7px;
          background: color-mix(in srgb, var(--t-surface) 48%, transparent); padding: 10px; cursor: pointer;
          display: flex; flex-direction: column; gap: 3px; min-height: 62px;
        }
        .visual-dna-domain--active { border-color: var(--t-text); background: var(--t-surface); }
        .visual-dna-domain span { font-weight: 800; font-size: 13px; }
        .visual-dna-domain small { color: color-mix(in srgb, var(--t-text) 60%, transparent); font-size: 11px; line-height: 1.25; }
        .visual-dna-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
        .visual-dna-field span { font-size: 11px; font-weight: 800; text-transform: uppercase; color: color-mix(in srgb, var(--t-text) 68%, transparent); }
        .visual-dna-field input, .visual-dna-field textarea {
          width: 100%; border: 1px solid color-mix(in srgb, var(--t-text) 14%, transparent); border-radius: 7px;
          background: color-mix(in srgb, var(--t-surface) 72%, transparent); color: var(--t-text); padding: 10px 11px;
          font: inherit; font-size: 13px; outline: none; resize: vertical;
        }
        #visual-dna-upload-row { display: flex; align-items: center; gap: 10px; margin: 14px 0; }
        .visual-dna-secondary, #visual-dna-submit {
          border: 0; border-radius: 7px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
          min-height: 34px; padding: 0 12px; font-weight: 800; font-size: 12px;
        }
        .visual-dna-secondary { background: var(--t-border-subtle); color: var(--t-text); }
        #visual-dna-submit { width: 100%; background: var(--t-text); color: var(--t-text-inverse); min-height: 40px; }
        #visual-dna-file-count { font-size: 12px; color: color-mix(in srgb, var(--t-text) 64%, transparent); }
        #visual-dna-error { margin: 0 0 12px; color: var(--t-danger); font-size: 12px; }
        #visual-dna-profile-list { display: flex; flex-direction: column; gap: 12px; }
        .visual-dna-profile {
          border: 1px solid var(--t-border-subtle); border-radius: 8px;
          background: color-mix(in srgb, var(--t-surface) 56%, transparent); padding: 12px;
        }
        .visual-dna-profile-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 10px; }
        .visual-dna-profile h3 { margin: 0; font-size: 15px; line-height: 1.2; }
        .visual-dna-profile span { display: block; margin-top: 2px; font-size: 11px; color: color-mix(in srgb, var(--t-text) 58%, transparent); }
        .visual-dna-profile strong { font-size: 10px; text-transform: uppercase; border: 1px solid var(--t-border-subtle); border-radius: 999px; padding: 3px 7px; }
        .visual-dna-thumbs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-bottom: 10px; }
        .visual-dna-thumbs img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 5px; }
        .visual-dna-profile p { margin: 0 0 10px; font-size: 12px; line-height: 1.45; color: color-mix(in srgb, var(--t-text) 76%, transparent); }
        .visual-dna-profile pre {
          margin: 0; white-space: pre-wrap; font-size: 11px; line-height: 1.45;
          background: color-mix(in srgb, var(--t-text) 7%, transparent); border-radius: 6px; padding: 10px;
        }
        #visual-dna-empty {
          border: 1px dashed color-mix(in srgb, var(--t-text) 18%, transparent); border-radius: 8px; padding: 18px;
          color: color-mix(in srgb, var(--t-text) 62%, transparent); font-size: 13px; line-height: 1.45;
        }
        @media (max-width: 820px) {
          #visual-dna-overlay { padding: 10px; }
          #visual-dna-shell { max-height: 94vh; }
          #visual-dna-body { grid-template-columns: 1fr; overflow-y: auto; }
          #visual-dna-builder { border-right: 0; border-bottom: 1px solid color-mix(in srgb, var(--t-text) 10%, transparent); }
          #visual-dna-builder, #visual-dna-profiles { overflow: visible; }
        }
      `}</style>
    </div>
  );
}
