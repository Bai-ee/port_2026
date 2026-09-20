'use client';

import React, { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { CalendarDays, Library } from 'lucide-react';
import { fallbackDraft, validateDraft } from '../../features/x-content-inventory/draft.js';

// Content Engine — the supply side of the posting plan.
//
// The X Calendar card answers WHEN to post and WHAT TYPE. This one answers
// WHICH PIECE OF CONTENT and, once there is copy, WHAT IT SAYS. Two panels:
// PLAN (today's slots with content matched into them) and INVENTORY (the
// ContentPackage rows those matches come from).
//
// Everything here is Firestore-only. The plan is computed server-side by
// features/x-content-inventory/plan-day.js — pure, no network, no spend — and
// the draft preview below is computed IN THE BROWSER from the author's own
// story text. The model-written draft is deliberately NOT here: it costs money
// per call, so it stays a local command the way the quote scan does.
//
// ⚠️ Styling trap (same as XCalendarCard / XMonitorCard): this uses
// `<style jsx global>` with EVERY selector prefixed `#x-content-card`, because
// plain `<style jsx>` only scopes JSX written directly in THIS component's
// return — markup rendered by the child panels never receives the generated
// class. Handing the tag a variable instead of an inline template literal
// fails the compile and renders an empty pane. All panel CSS therefore lives
// in this one block, and the panels emit classNames only.

const PlanPanel = dynamic(() => import('./x-content/PlanPanel'), { ssr: false });
const InventoryPanel = dynamic(() => import('./x-content/InventoryPanel'), { ssr: false });

const ENDPOINT = '/api/dashboard/quote-targets';

export default function XContentEngineCard({ getIdToken, activeClientId, clientName }) {
  const [tab, setTab] = useState('plan');
  const [posts, setPosts] = useState(5);

  const [plan, setPlan] = useState(null);
  const [packages, setPackages] = useState([]);
  const [audit, setAudit] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [draftingId, setDraftingId] = useState(null);
  const [drafts, setDrafts] = useState({});

  const call = useCallback(async (action, body = {}) => {
    const token = getIdToken ? await getIdToken() : null;
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `${action} failed.`);
    return data;
  }, [getIdToken]);

  const load = useCallback(async (nextPosts = posts) => {
    setLoading(true);
    setError('');
    try {
      const [planRes, invRes] = await Promise.all([
        call('content-plan', { posts: nextPosts }),
        call('inventory-list'),
      ]);
      setPlan(planRes?.plan || null);
      setPackages(Array.isArray(invRes?.packages) ? invRes.packages : []);
      setAudit(invRes?.audit || null);
    } catch (err) {
      setError(err.message || 'Could not load the content engine.');
    } finally {
      setLoading(false);
    }
  }, [call, posts]);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeClientId]);

  const onPostsChange = useCallback((next) => {
    setPosts(next);
    load(next);
  }, [load]);

  const onSave = useCallback(async (pkg) => {
    setSavingId(pkg?.id || 'new');
    setError('');
    try {
      await call('inventory-save', { pkg });
      await load();
    } catch (err) {
      setError(err.message || 'Could not save.');
    } finally {
      setSavingId(null);
    }
  }, [call, load]);

  const onDelete = useCallback(async (id) => {
    setSavingId(id);
    setError('');
    try {
      await call('inventory-delete', { id });
      await load();
    } catch (err) {
      setError(err.message || 'Could not delete.');
    } finally {
      setSavingId(null);
    }
  }, [call, load]);

  // The draft preview is deterministic and local: it truncates the author's
  // own story rather than paraphrasing it, and runs the same mechanical rules
  // the CLI runs. A model-written version costs a call per slot, so it stays
  // in `scripts/x-content/draft-day.mjs --execute`.
  const onDraft = useCallback((slot) => {
    const key = slot?.slot || slot?.packageId;
    if (!key) return;
    setDraftingId(key);
    try {
      const pkg = packages.find((p) => p.id === slot.packageId) || { story: slot.story, series: slot.series };
      const text = fallbackDraft({ pkg, slot });
      setDrafts((s) => ({ ...s, [key]: { text, check: validateDraft(text, { series: slot.series, slotType: slot.type }) } }));
    } finally {
      setDraftingId(null);
    }
  }, [packages]);

  return (
    <div id="x-content-card">
      <div id="x-content-tabs" className="xce-tabs" role="tablist">
        <button
          type="button"
          id="x-content-tab-plan"
          className={`xce-tab${tab === 'plan' ? ' xce-tab-active' : ''}`}
          onClick={() => setTab('plan')}
          role="tab"
          aria-selected={tab === 'plan'}
        >
          <CalendarDays size={13} /> Plan
        </button>
        <button
          type="button"
          id="x-content-tab-inventory"
          className={`xce-tab${tab === 'inventory' ? ' xce-tab-active' : ''}`}
          onClick={() => setTab('inventory')}
          role="tab"
          aria-selected={tab === 'inventory'}
        >
          <Library size={13} /> Content{packages.length ? ` (${packages.length})` : ''}
        </button>
      </div>

      {clientName ? <p id="x-content-client-line" className="xce-client">{clientName}</p> : null}

      {tab === 'plan' ? (
        <PlanPanel
          plan={plan}
          loading={loading}
          error={error}
          posts={posts}
          onPostsChange={onPostsChange}
          onRefresh={() => load()}
          onDraft={onDraft}
          draftingId={draftingId}
          drafts={drafts}
        />
      ) : (
        <InventoryPanel
          packages={packages}
          audit={audit}
          loading={loading}
          error={error}
          savingId={savingId}
          onSave={onSave}
          onDelete={onDelete}
        />
      )}

      <style jsx global>{`
        /* Mobile first: every rule below is the phone layout. Widening happens
           only in the one min-width block at the bottom. */
        #x-content-card { margin-top: 18px; display: grid; gap: 12px; }

        #x-content-card .xce-tabs { display: flex; gap: 6px; }
        #x-content-card .xce-tab { flex: 1; min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 12px; border-radius: 10px; border: 1px solid rgba(42,36,32,0.12); background: rgba(255,255,255,0.6); font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(42,36,32,0.6); cursor: pointer; }
        #x-content-card .xce-tab-active { background: #2a2420; border-color: #2a2420; color: #fff; }
        #x-content-card .xce-client { margin: 0; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.06em; color: rgba(42,36,32,0.5); }

        #x-content-card .xce-panel { border: 1px solid rgba(42,36,32,0.12); background: rgba(255,255,255,0.72); border-radius: 16px; padding: 14px; box-shadow: 0 1px 0 rgba(255,255,255,0.7), inset 0 1px 0 rgba(255,255,255,0.4); backdrop-filter: blur(20px); }
        #x-content-card .xce-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
        #x-content-card .xce-kicker { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(42,36,32,0.62); }
        #x-content-card .xce-sub { margin: 0; font-family: var(--font-mono); font-size: 11px; color: rgba(42,36,32,0.55); }
        #x-content-card .xce-empty { border: 1px dashed rgba(42,36,32,0.16); border-radius: 12px; background: rgba(255,255,255,0.4); padding: 18px 14px; text-align: center; font-size: 13px; line-height: 1.5; color: rgba(42,36,32,0.55); }
        #x-content-card .xce-error { margin: 0 0 10px; font-size: 12px; line-height: 1.4; color: #9f1f17; }

        /* Buttons */
        #x-content-card .xce-btn { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 14px; border-radius: 10px; border: 1px solid #2a2420; background: #2a2420; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; }
        #x-content-card .xce-btn:disabled { opacity: 0.5; cursor: default; }
        #x-content-card .xce-ghost { min-height: 34px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 12px; border-radius: 10px; border: 1px solid rgba(42,36,32,0.16); background: rgba(255,255,255,0.7); color: #2a2420; font-size: 11px; font-weight: 700; cursor: pointer; }
        #x-content-card .xce-danger { border-color: rgba(159,31,23,0.3); color: #9f1f17; background: rgba(159,31,23,0.05); }

        /* Tier selector */
        #x-content-card .xce-tier { display: inline-flex; gap: 4px; }
        #x-content-card .xce-tier button { min-height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid rgba(42,36,32,0.14); background: rgba(255,255,255,0.7); font-family: var(--font-mono); font-size: 11px; color: rgba(42,36,32,0.6); cursor: pointer; }
        #x-content-card .xce-tier button[aria-pressed="true"] { background: #2a2420; border-color: #2a2420; color: #fff; }

        /* Header bits */
        #x-content-card .xce-head-date { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: #2a2420; }
        #x-content-card .xce-head-count { font-family: var(--font-mono); font-size: 11px; color: rgba(42,36,32,0.55); }
        #x-content-card .xce-tier-selector { display: inline-flex; flex: 1 1 100%; border: 1px solid rgba(42,36,32,0.12); border-radius: 999px; padding: 2px; background: rgba(255,255,255,0.6); }
        #x-content-card .xce-tier-option { flex: 1 1 0; min-height: 36px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; font-size: 11.5px; font-weight: 700; color: rgba(42,36,32,0.6); cursor: pointer; }
        #x-content-card .xce-tier-option-active { background: #2a2420; color: #fff; }
        #x-content-card .xce-tier-option:disabled { opacity: 0.48; cursor: not-allowed; }
        #x-content-card .xce-refresh { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border: 1px solid rgba(42,36,32,0.12); border-radius: 999px; background: rgba(255,255,255,0.6); font-size: 11px; font-weight: 700; color: #2a2420; cursor: pointer; }
        #x-content-card .xce-refresh:disabled { opacity: 0.48; cursor: not-allowed; }

        /* States */
        #x-content-card .xce-loading { padding: 14px; text-align: center; font-size: 12.5px; color: rgba(42,36,32,0.55); }
        #x-content-card .xce-empty-note { font-size: 11.5px; color: rgba(42,36,32,0.45); }
        /* An unfilled slot is an inventory shortfall, not a failure — amber, not red. */
        #x-content-card .xce-shortfall { margin: 0; padding: 8px 10px; border-radius: 10px; background: rgba(183,121,31,0.08); border: 1px solid rgba(183,121,31,0.24); font-size: 12px; line-height: 1.45; color: #8a5a15; }
        #x-content-card .xce-audit { margin: 0; font-family: var(--font-mono); font-size: 10.5px; color: rgba(42,36,32,0.45); }

        /* Slot rows — stacked on a phone, never a horizontal scroll */
        #x-content-card .xce-slot-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        #x-content-card .xce-slot { display: grid; gap: 8px; padding: 10px; border-radius: 12px; border: 1px solid rgba(42,36,32,0.1); background: rgba(255,255,255,0.6); }
        #x-content-card .xce-slot-scan { background: rgba(255,255,255,0.45); }
        #x-content-card .xce-slot-ledger { border-color: rgba(47,158,107,0.24); }
        #x-content-card .xce-gap { border-style: dashed; border-color: rgba(183,121,31,0.4); background: rgba(183,121,31,0.05); }
        #x-content-card .xce-slot-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; min-width: 0; }
        #x-content-card .xce-slot-time { font-family: var(--font-mono); font-size: 11.5px; font-weight: 700; color: #2a2420; }
        #x-content-card .xce-slot-type { font-family: var(--font-mono); font-size: 11px; color: rgba(42,36,32,0.6); }
        #x-content-card .xce-slot-lane { font-family: var(--font-mono); font-size: 11px; color: rgba(42,36,32,0.45); }
        #x-content-card .xce-slot-score { font-family: var(--font-mono); font-size: 11px; padding: 2px 8px; border-radius: 999px; background: rgba(42,36,32,0.07); color: #2a2420; }
        #x-content-card .xce-slot-body { display: flex; gap: 10px; align-items: flex-start; min-width: 0; }
        #x-content-card .xce-slot-detail { min-width: 0; max-width: 100%; display: grid; gap: 4px; }
        #x-content-card .xce-slot-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        #x-content-card .xce-draft-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 38px; padding: 0 14px; border-radius: 999px; border: 1px solid rgba(42,36,32,0.12); background: rgba(255,255,255,0.6); font-size: 12px; font-weight: 700; color: #2a2420; cursor: pointer; }
        #x-content-card .xce-draft-button:disabled { opacity: 0.48; cursor: not-allowed; }

        /* Row content */
        #x-content-card .xce-muted { margin: 0; font-size: 12px; color: rgba(42,36,32,0.5); }
        #x-content-card .xce-post-text { margin: 0; font-size: 12.5px; line-height: 1.5; color: #2a2420; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        /* Package ids and post URLs are long and unbroken; without this they
           widen the row and reintroduce horizontal scrolling on a phone. */
        #x-content-card .xce-asset { margin: 0; font-family: var(--font-mono); font-size: 11px; color: rgba(42,36,32,0.55); overflow-wrap: anywhere; }
        #x-content-card .xce-asset a { color: inherit; text-decoration: none; }
        #x-content-card .xce-asset a:hover { text-decoration: underline; }
        #x-content-card .xce-reason { margin: 0; font-size: 11px; line-height: 1.45; color: rgba(42,36,32,0.5); }
        #x-content-card .xce-pkg-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; min-width: 0; }
        #x-content-card .xce-pkg-id { font-family: var(--font-mono); font-size: 11.5px; font-weight: 700; color: #2a2420; overflow-wrap: anywhere; }
        #x-content-card .xce-story { margin: 0; font-size: 12.5px; line-height: 1.5; color: rgba(42,36,32,0.78); }
        #x-content-card .xce-self-reply { margin: 0; font-size: 11.5px; line-height: 1.45; color: rgba(42,36,32,0.6); }
        #x-content-card .xce-self-reply-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(42,36,32,0.45); }
        #x-content-card .xce-gap-label { margin: 0; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #8a5a15; }
        #x-content-card .xce-gap-need { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(42,36,32,0.7); }

        /* Placeholder artwork — CSS only. The archive is not populated yet, so
           nothing here loads an image or reaches the network. */
        #x-content-card .xce-thumb { flex: 0 0 auto; width: 48px; height: 48px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(42,36,32,0.12); background: linear-gradient(135deg, rgba(42,36,32,0.10), rgba(42,36,32,0.04)); color: rgba(42,36,32,0.6); }
        #x-content-card .xce-thumb-code { font-family: var(--font-mono); font-size: 13px; font-weight: 700; letter-spacing: 0.04em; color: #2a2420; }
        #x-content-card .xce-thumb-gap { background: transparent; border-style: dashed; border-color: rgba(183,121,31,0.4); color: rgba(183,121,31,0.7); }

        /* Chips */
        #x-content-card .xce-chip { display: inline-flex; align-items: center; min-height: 22px; padding: 0 8px; border-radius: 999px; border: 1px solid rgba(42,36,32,0.1); background: rgba(42,36,32,0.05); font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; color: #3a332e; }
        #x-content-card .xce-chip-adopted { border-color: rgba(47,158,107,0.3); background: rgba(47,158,107,0.1); color: #23684a; }
        #x-content-card .xce-chip-warn { border-color: rgba(183,121,31,0.3); background: rgba(183,121,31,0.08); color: #8a5a15; }

        /* Draft preview */
        #x-content-card .xce-draft { margin-top: 8px; padding: 10px; border-radius: 10px; border: 1px solid rgba(42,36,32,0.12); background: rgba(255,255,255,0.85); }
        #x-content-card .xce-draft-text { margin: 0 0 6px; font-size: 13px; line-height: 1.5; color: #2a2420; }
        #x-content-card .xce-draft-meta { margin: 0; font-family: var(--font-mono); font-size: 10.5px; color: rgba(42,36,32,0.5); }
        #x-content-card .xce-draft-bad { color: #9f1f17; }

        /* ── Inventory ────────────────────────────────────────────────── */
        #x-content-card .xce-inv { display: grid; gap: 12px; }
        #x-content-card .xce-inv-section { display: grid; gap: 8px; }
        #x-content-card .xce-inv-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        #x-content-card .xce-inv-kicker { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(42,36,32,0.62); }
        #x-content-card .xce-inv-count { font-family: var(--font-mono); font-size: 11px; color: rgba(42,36,32,0.5); }
        #x-content-card .xce-inv-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        #x-content-card .xce-inv-row-item { min-width: 0; }
        #x-content-card .xce-inv-row { display: grid; grid-template-columns: 44px 1fr; align-items: start; gap: 10px; padding: 10px; border-radius: 12px; border: 1px solid rgba(42,36,32,0.1); background: rgba(255,255,255,0.6); text-align: left; cursor: pointer; width: 100%; font: inherit; }
        #x-content-card .xce-inv-row-active { border-color: #2a2420; }
        #x-content-card .xce-inv-row-main { min-width: 0; display: grid; gap: 4px; }
        #x-content-card .xce-inv-row-title { margin: 0; font-size: 13px; font-weight: 700; line-height: 1.35; color: #2a2420; overflow-wrap: anywhere; }
        #x-content-card .xce-inv-row-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 0; }
        #x-content-card .xce-inv-meta-item { font-family: var(--font-mono); font-size: 10.5px; color: rgba(42,36,32,0.5); }
        #x-content-card .xce-inv-row-flags { display: flex; flex-wrap: wrap; gap: 6px; }
        #x-content-card .xce-inv-thumb { flex: 0 0 auto; width: 44px; height: 44px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(42,36,32,0.12); background: linear-gradient(135deg, rgba(42,36,32,0.10), rgba(42,36,32,0.04)); font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: #2a2420; }
        #x-content-card .xce-inv-title { margin: 0; font-size: 13px; font-weight: 700; color: #2a2420; }
        #x-content-card .xce-inv-meta { margin: 2px 0 0; font-family: var(--font-mono); font-size: 10.5px; color: rgba(42,36,32,0.5); }

        /* Editor form */
        #x-content-card .xce-editor { display: grid; gap: 10px; padding-top: 4px; border-top: 1px solid rgba(42,36,32,0.1); }
        #x-content-card .xce-form { display: grid; gap: 10px; }
        #x-content-card .xce-form-grid { display: grid; gap: 10px; }
        #x-content-card .xce-field { display: grid; gap: 4px; min-width: 0; }
        #x-content-card .xce-field-label,
        #x-content-card .xce-field label { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(42,36,32,0.55); }
        #x-content-card .xce-field-hint,
        #x-content-card .xce-field-note { margin: 0; font-size: 11px; line-height: 1.4; color: rgba(42,36,32,0.5); }
        #x-content-card .xce-hint-strong { font-weight: 700; color: rgba(42,36,32,0.72); }
        /* 16px inputs: anything smaller makes iOS zoom the whole modal on focus. */
        #x-content-card .xce-input,
        #x-content-card .xce-select,
        #x-content-card .xce-textarea,
        #x-content-card .xce-field input,
        #x-content-card .xce-field select,
        #x-content-card .xce-field textarea { width: 100%; min-height: 38px; border: 1px solid rgba(42,36,32,0.14); border-radius: 10px; padding: 8px 10px; background: rgba(255,255,255,0.98); color: #2a2420; font-family: inherit; font-size: 16px; line-height: 1.45; outline: none; }
        #x-content-card .xce-textarea,
        #x-content-card .xce-field textarea { min-height: 120px; resize: vertical; }
        #x-content-card .xce-input:focus,
        #x-content-card .xce-select:focus,
        #x-content-card .xce-textarea:focus,
        #x-content-card .xce-field input:focus,
        #x-content-card .xce-field select:focus,
        #x-content-card .xce-field textarea:focus { border-color: rgba(42,36,32,0.36); box-shadow: 0 0 0 3px rgba(42,36,32,0.08); }
        #x-content-card .xce-toggle-row { display: flex; flex-wrap: wrap; gap: 8px; }
        #x-content-card .xce-toggle { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 10px; border-radius: 999px; border: 1px solid rgba(42,36,32,0.14); background: rgba(255,255,255,0.7); font-size: 12px; color: rgba(42,36,32,0.75); cursor: pointer; }
        #x-content-card .xce-toggle input { width: auto; min-height: 0; margin: 0; }

        /* Actions */
        #x-content-card .xce-actions,
        #x-content-card .xce-form-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
        #x-content-card .xce-btn-primary { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 14px; border-radius: 10px; border: 1px solid #2a2420; background: #2a2420; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; }
        #x-content-card .xce-btn-ghost { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 14px; border-radius: 10px; border: 1px solid rgba(42,36,32,0.16); background: rgba(255,255,255,0.7); color: #2a2420; font-size: 12px; font-weight: 700; cursor: pointer; }
        #x-content-card .xce-btn-danger { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 14px; border-radius: 10px; border: 1px solid rgba(159,31,23,0.3); background: rgba(159,31,23,0.05); color: #9f1f17; font-size: 12px; font-weight: 700; cursor: pointer; }
        #x-content-card .xce-btn-primary:disabled,
        #x-content-card .xce-btn-ghost:disabled,
        #x-content-card .xce-btn-danger:disabled { opacity: 0.48; cursor: not-allowed; }

        /* Validation feedback. Errors block the save; warnings are advice and
           must never look like failures, or nobody reads either. */
        #x-content-card .xce-feedback { border-radius: 10px; padding: 8px 10px; border: 1px solid transparent; }
        #x-content-card .xce-feedback-head { margin: 0; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
        #x-content-card .xce-feedback-list { margin: 6px 0 0; padding-left: 16px; display: grid; gap: 4px; font-size: 11.5px; line-height: 1.45; }
        #x-content-card .xce-feedback-error { border-color: rgba(159,31,23,0.24); background: rgba(159,31,23,0.05); color: #9f1f17; }
        #x-content-card .xce-feedback-warn { border-color: rgba(183,121,31,0.24); background: rgba(183,121,31,0.06); color: #8a5a15; }
        #x-content-card .xce-warn-list { margin: 6px 0 0; padding-left: 16px; display: grid; gap: 4px; font-size: 11.5px; line-height: 1.45; color: #8a5a15; }
        #x-content-card .xce-err-list { margin: 6px 0 0; padding-left: 16px; display: grid; gap: 4px; font-size: 11.5px; line-height: 1.45; color: #9f1f17; }
        #x-content-card .xce-notice { margin: 0; font-size: 12px; line-height: 1.45; color: rgba(42,36,32,0.6); }
        #x-content-card .xce-notice-error { color: #9f1f17; }
        #x-content-card .xce-chip-series { font-family: var(--font-mono); letter-spacing: 0.04em; }
        #x-content-card .xce-chip-status { background: rgba(255,255,255,0.6); border-color: rgba(42,36,32,0.14); color: rgba(42,36,32,0.55); }
        #x-content-card .xce-chip-error { border-color: rgba(159,31,23,0.28); background: rgba(159,31,23,0.07); color: #9f1f17; }
        #x-content-card .xce-checks { display: flex; flex-wrap: wrap; gap: 8px; }
        #x-content-card .xce-check { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; font-size: 12px; color: rgba(42,36,32,0.75); }
        #x-content-card .xce-check input { width: auto; min-height: 0; }

        /* State modifiers the panels emit alongside their base classes. */
        #x-content-card .xce-inv-row.is-active { border-color: rgba(42,36,32,0.4); background: rgba(255,255,255,0.95); }
        #x-content-card .xce-inv-row.is-busy { opacity: 0.6; pointer-events: none; }
        #x-content-card .xce-toggle.is-on { background: #2a2420; border-color: #2a2420; color: #fff; }
        #x-content-card .xce-input.is-locked { background: rgba(42,36,32,0.04); color: rgba(42,36,32,0.6); cursor: default; }
        /* A long series label ("C1 · Record of the Day") is the one chip that
           can push a row wider than the phone and bring back horizontal scroll. */
        #x-content-card .xce-chip-series { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #x-content-card .xce-inv-row-flags { grid-column: 1 / -1; }

        /* MOBILE WIDTH STANDARD — at ≤480px the padding chain collapses to the
           single shared gutter so content spans the viewport.
           See docs/dashboard-ui/MOBILE-WIDTH-STANDARD.md. */
        @media (max-width: 480px) {
          #x-content-card .xce-panel,
          #x-content-card .xce-inv-section { padding: 12px var(--mobile-gutter, 8px); border-radius: 12px; }
          #x-content-card .xce-actions .xce-btn,
          #x-content-card .xce-actions .xce-btn-primary,
          #x-content-card .xce-actions .xce-btn-ghost,
          #x-content-card .xce-actions .xce-btn-danger { flex: 1 1 auto; }
        }

        /* The only widening rule. Below this everything is one column. */
        @media (min-width: 640px) {
          #x-content-card .xce-inv-row { grid-template-columns: 44px minmax(0,1fr) auto; }
          #x-content-card .xce-inv-row-flags { grid-column: auto; justify-content: flex-end; }
          #x-content-card .xce-tier-selector { flex: 0 0 auto; margin-left: auto; }
          #x-content-card .xce-slot-score { margin-left: auto; }
          #x-content-card .xce-thumb { width: 56px; height: 56px; }
          #x-content-card .xce-panel { padding: 16px; }
          #x-content-card .xce-slot { grid-template-columns: 44px 1fr; }
          #x-content-card .xce-form-grid { grid-template-columns: 1fr 1fr; }
          #x-content-card .xce-field-wide { grid-column: 1 / -1; }
        }
      `}</style>
    </div>
  );
}
