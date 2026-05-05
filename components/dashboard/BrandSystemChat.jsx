'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ── Image compression ──────────────────────────────────────────────────────────
const MAX_BASE64_BYTES = 4_500_000;
async function compressToLimit(dataUrl) {
  if (dataUrl.startsWith('data:image/svg')) return dataUrl;
  const b64 = dataUrl.split(',')[1] || '';
  if (b64.length <= MAX_BASE64_BYTES) return dataUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const steps = [
        { maxDim: 1920, q: 0.85 },
        { maxDim: 1440, q: 0.80 },
        { maxDim: 1280, q: 0.75 },
        { maxDim: 960,  q: 0.70 },
        { maxDim: 800,  q: 0.65 },
      ];
      for (const { maxDim, q } of steps) {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w >= h) { h = Math.round(h * maxDim / w); w = maxDim; }
          else        { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        const out = c.toDataURL('image/jpeg', q);
        if ((out.split(',')[1] || '').length <= MAX_BASE64_BYTES) { resolve(out); return; }
      }
      resolve(dataUrl);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ── Template options ───────────────────────────────────────────────────────────
const TEMPLATE_OPTIONS = [
  { id: 'brand-poster',    label: 'Brand Identity Poster',     description: 'Vertical 4:5 full brand poster' },
  { id: 'storyboard',      label: 'Storyboard / Cinematic',    description: '16:9 storyboard — 10 panels' },
  { id: 'product-shots',   label: 'Product Shots',             description: 'Studio product photography renders' },
  { id: 'web-design',      label: 'Website Hero',              description: 'Full desktop viewport — nav, hero, CTA' },
  { id: 'character-sheet', label: 'Character Sheet',           description: 'Mascot — turnarounds, expressions' },
  { id: 'social-media',    label: 'Social Media Pack',         description: 'Square (1:1), Story (9:16), Banner' },
];

// ── History reconstruction helpers ────────────────────────────────────────────

function extractDisplayText(gap, uploads) {
  const { id, type } = gap;

  if (type === 'image') {
    if (id === 'logo')         return uploads.logoVisionAnalysis ? 'Logo uploaded & analyzed' : null;
    if (id === 'color-palette') {
      const cp = uploads.colorPalette;
      if (!cp) return null;
      return cp.skipped ? '—' : 'Color palette uploaded & analyzed';
    }
    return null;
  }

  if (type === 'image-multi') {
    const fieldMap = { 'mood-board': 'moodBoard', 'brand-photos': 'brandPhotos', 'competitor-refs': 'competitorRefs', 'product-shots': 'productShots' };
    const arr = uploads[fieldMap[id]];
    if (!Array.isArray(arr) || !arr.length) return null;
    if (arr[0]?.skipped) return '—';
    return `${arr.length} image${arr.length === 1 ? '' : 's'} uploaded`;
  }

  const ddMap = { 'site-review-love': 'keep', 'site-review-change': 'change', 'site-review-add': 'add' };
  if (ddMap[id]) {
    const arr = uploads.designDirection?.[ddMap[id]];
    if (!Array.isArray(arr) || !arr.length) return null;
    if (arr[0] === '(skipped)') return '—';
    return arr.join(', ');
  }
  if (id === 'site-review-confidence') {
    const score = uploads.designDirection?.confidenceScore;
    if (score == null) return null;
    if (score === 0) return '—';
    return gap.choices?.[score - 1] || String(score);
  }

  const simpleMap = {
    'soul-descriptors':   'soulDescriptors',
    'visual-language':    'visualLanguage',
    'lighting':           'lighting',
    'material':           'material',
    'photo-direction':    'photoDirection',
    'brand-archetype':    'brandArchetype',
    'composition-style':  'compositionStyle',
    'color-mood':         'colorMood',
    'motion-intent':      'motionIntent',
    'layout-grid':        'layoutGrid',
    'headline-specimen':  'headlineSpecimen',
    'target-output':      'targetOutput',
  };
  const field = simpleMap[id];
  if (field) {
    const val = uploads[field];
    if (!val) return null;
    if (val === '(skipped)') return '—';
    if (Array.isArray(val)) return val.join(' / ');
    return String(val);
  }
  return null;
}

function extractUploadPreviews(gap, uploads) {
  const u = uploads?.uploadUrls || {};
  switch (gap.id) {
    case 'logo':          return { imagePreview: u.logo || uploads?.logoUrl || null };
    case 'color-palette': return { imagePreview: u.colorPalette || null };
    case 'mood-board':    return { imagePreviews: u.moodBoard?.slice(0, 4) || null };
    case 'brand-photos':  return { imagePreviews: u.brandPhotos?.slice(0, 4) || null };
    case 'competitor-refs': return { imagePreviews: u.competitorRefs?.slice(0, 4) || null };
    case 'product-shots': return { imagePreviews: u.productShots?.slice(0, 4) || null };
    default:              return {};
  }
}

function buildHistoryMessages(allGapDefs, previousUploads, homepageScreenshotUrl) {
  const uploads = previousUploads || {};
  const msgs = [];
  for (const gap of allGapDefs) {
    const displayText = extractDisplayText(gap, uploads);
    if (displayText === null) continue;

    // Embed screenshot into gap object so render doesn't rely on async state.
    const gapObj = (gap.showsScreenshot && homepageScreenshotUrl)
      ? { ...gap, embeddedScreenshotUrl: homepageScreenshotUrl }
      : gap;

    msgs.push({ id: `gap-${gap.id}`, role: 'bot', type: 'gap', gap: gapObj, answered: true });

    const previews = extractUploadPreviews(gap, uploads);
    msgs.push({
      id: `u-hist-${gap.id}`, role: 'user', text: displayText,
      gapId: gap.id, gapObject: gapObj,
      rawValue: (gap.type === 'text' || gap.type === 'short-text-list') ? displayText : null,
      ...previews,
    });
  }
  return msgs;
}

/**
 * BrandSystemChat — conversational gap-fill + template selector + image generation.
 * Renders inside BrandSystemBuildModal's survey column using the same chat-shell
 * visual language as OnboardingChatModal (avatar, bubbles, chips, progress rail).
 */
export default function BrandSystemChat({ getIdToken, onComplete, onLog }) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [messages, setMessages]                 = useState([]);
  const [typing, setTyping]                     = useState(true);
  const [completeness, setCompleteness]         = useState(0);
  const [totalGaps, setTotalGaps]               = useState(0);
  const [currentGap, setCurrentGap]             = useState(null);
  const [submitting, setSubmitting]             = useState(false);
  const [textInput, setTextInput]               = useState('');
  const [selectedFiles, setSelectedFiles]       = useState([]);
  const [finalResult, setFinalResult]           = useState(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState('brand-poster');
  const [copied, setCopied]                     = useState(false);
  const [generating, setGenerating]             = useState(false);
  const [scanError, setScanError]               = useState(null);
  const [homepageScreenshotUrl, setHomepageScreenshotUrl] = useState(null);
  const [phase, setPhase]                       = useState('loading');

  // Derived — automatically reflects edits/trims to messages array
  const answeredCount = useMemo(() => messages.filter((m) => m.role === 'user').length, [messages]);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const hasScannedRef  = useRef(false);
  const onLogRef       = useRef(onLog);
  const fileInputRef   = useRef(null);
  const multiFileRef   = useRef(null);
  const scrollRef      = useRef(null);

  useEffect(() => { onLogRef.current = onLog; });

  const log = useCallback((type, prefix, text, cursor = false) => {
    onLogRef.current?.({ type, prefix, text, cursor });
  }, []);

  // Auto-scroll on new messages or typing indicator change
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, typing]);

  // ── Message helpers ────────────────────────────────────────────────────────
  const pushMessage = useCallback((msg) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const markAnswered = useCallback((gapId) => {
    setMessages((prev) =>
      prev.map((m) => (m.type === 'gap' && m.gap?.id === gapId ? { ...m, answered: true } : m))
    );
  }, []);

  // Edit a previous answer — trims messages back to that gap and re-activates input.
  const handleEditAnswer = useCallback((gapId, gapObject, rawValue) => {
    setMessages((prev) => {
      const gapMsgIdx = prev.findIndex((m) => m.type === 'gap' && m.gap?.id === gapId);
      if (gapMsgIdx === -1) return prev;
      // Find the user reply for this gap (first user msg after the gap msg)
      const userMsgIdx = prev.findIndex((m, i) => i > gapMsgIdx && m.role === 'user' && m.gapId === gapId);
      const cutIdx = userMsgIdx !== -1 ? userMsgIdx : gapMsgIdx + 1;
      // Keep up to (not including) the user answer, re-activate the gap input
      return prev.slice(0, cutIdx).map((m) =>
        m.type === 'gap' && m.gap?.id === gapId ? { ...m, answered: false } : m
      );
    });
    setCurrentGap(gapObject);
    setTextInput(typeof rawValue === 'string' ? rawValue : '');
    setSelectedFiles([]);
    setPhase('chat');
  }, []);

  // ── Scan on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (hasScannedRef.current) return;
    hasScannedRef.current = true;
    let cancelled = false;

    (async () => {
      log('system', '$', 'brand-system / scan — starting');
      log('dim',    '',       '──────────────────────────────────────────────');
      log('active', '[SCAN]', 'Reading dashboard pipeline data…', true);

      let token;
      try { token = await getIdToken(); }
      catch {
        if (cancelled) return;
        log('error', '[ERR]', 'Could not get auth token.');
        setScanError('Could not get auth token.');
        setTyping(false);
        setPhase('error');
        return;
      }

      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 30_000);
        let res;
        try {
          res = await fetch('/api/brand-system/scan', {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
            signal: controller.signal,
          });
        } finally {
          clearTimeout(tid);
        }

        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          const msg = data?.error || `Scan failed (${res.status}).`;
          log('error', '[ERR]', msg);
          setScanError(msg);
          setTyping(false);
          setPhase('error');
          return;
        }

        const gaps = data.gaps || [];
        const pct  = Math.round((data.completeness || 0) * 100);
        log('ok',    '✓',       'pipeline read');
        log('build', '[BUILD]', `${pct}% of the prompt is auto-filled`);
        if (data.homepageScreenshotUrl) {
          setHomepageScreenshotUrl(data.homepageScreenshotUrl);
          log('info', '[PHASE1]', 'homepage screenshot found');
        }

        setCompleteness(data.completeness || 0);
        setTotalGaps(gaps.length);

        // Brief natural pause before first message appears
        await new Promise((r) => setTimeout(r, 700));
        if (cancelled) return;

        setTyping(false);

        if (!gaps.length) {
          log('ok', '✓', 'no gaps — Brand Guide already assembled');
          const last = data.lastRun || null;
          setFinalResult({
            json: last?.json, jsonV2: last?.jsonV2, masterPrompt: last?.masterPrompt,
            prompts: last?.prompts, selectedPrompt: last?.selectedPrompt,
            selectedTemplateId: last?.selectedTemplateId,
            sources: last?.sources, generatedAt: last?.generatedAt,
          });
          setSelectedTemplateId(last?.selectedTemplateId || 'brand-poster');

          // Reconstruct previous Q&A so the user can scroll up and edit answers.
          const history = (data.allGapDefs && data.previousUploads)
            ? buildHistoryMessages(data.allGapDefs, data.previousUploads, data.homepageScreenshotUrl || null)
            : [];
          const hasHistory = history.length > 0;
          setTotalGaps(history.filter((m) => m.role === 'user').length);

          pushMessage({
            id: 'scan-summary', role: 'bot', type: 'scan-summary',
            text: hasHistory
              ? `${pct}% of your Brand Guide is assembled. Scroll up to review and edit any answer.`
              : `${pct}% of your Brand Guide is already filled from pipeline data.`,
          });
          for (const msg of history) pushMessage(msg);
          pushMessage({ id: `complete-${Date.now()}`, role: 'bot', type: 'complete', answered: false });
          setPhase('template-select');
          return;
        }

        const req = gaps.filter((g) => g.required).length;
        const opt = gaps.length - req;
        log('ai', '[CHAT]', `${req} required + ${opt} optional gap${gaps.length === 1 ? '' : 's'} to fill`);

        pushMessage({
          id: 'scan-summary', role: 'bot', type: 'scan-summary',
          text: `${pct}% auto-filled from your pipeline. I need a few more details to complete your Brand Guide.`,
        });
        log('active', '[CHAT]', gaps[0].question, true);
        pushMessage({ id: `gap-${gaps[0].id}`, role: 'bot', type: 'gap', gap: gaps[0], answered: false });
        setCurrentGap(gaps[0]);
        setPhase('chat');

      } catch (err) {
        if (cancelled) return;
        const msg = err?.message || 'Scan request failed.';
        log('error', '[ERR]', msg);
        setScanError(msg);
        setTyping(false);
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
      hasScannedRef.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Submit answer ──────────────────────────────────────────────────────────
  const submitAnswer = useCallback(async ({ value, imageBase64, mediaType, images, displayValue, skipped, imagePreview, imagePreviews }) => {
    if (!currentGap || submitting) return;
    setSubmitting(true);

    const displayText = skipped
      ? '—'
      : displayValue || (typeof value === 'string' ? value : '[image uploaded]');

    log('ai', '[YOU]', displayText);
    if (!skipped && currentGap.id === 'logo')
      log('build', '[VISION]', 'Analyzing logo with Claude vision…');
    if (!skipped && ['mood-board', 'brand-photos', 'competitor-refs'].includes(currentGap.id))
      log('build', '[VISION]', `Analyzing ${images?.length || 1} image${images?.length === 1 ? '' : 's'} with Claude vision…`);
    if (!skipped && currentGap.id === 'color-palette')
      log('build', '[VISION]', 'Extracting color palette…');

    markAnswered(currentGap.id);
    pushMessage({
      id: `u-${Date.now()}`, role: 'user', text: displayText,
      gapId: currentGap.id, gapObject: currentGap,
      rawValue: typeof value === 'string' ? value : null,
      imagePreview: imagePreview || null,
      imagePreviews: imagePreviews || null,
    });

    let token;
    try { token = await getIdToken(); }
    catch {
      log('error', '[ERR]', 'Could not get auth token.');
      setSubmitting(false);
      return;
    }

    let res, data;
    try {
      res = await fetch('/api/brand-system/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          gapId: currentGap.id, value, imageBase64, mediaType,
          images: images || [], skipped: !!skipped,
        }),
      });
      data = await res.json().catch(() => ({}));
    } catch (err) {
      log('error', '[ERR]', err?.message || 'Chat request failed.');
      setSubmitting(false);
      return;
    }

    if (!res.ok) {
      log('error', '[ERR]', data?.error || `Chat failed (${res.status}).`);
      setSubmitting(false);
      return;
    }

    // Typing delay
    setTyping(true);
    await new Promise((r) => setTimeout(r, 520));
    setTyping(false);

    if (data.done) {
      log('ok', '[OK]', 'Brand Guide assembled — all 6 output templates generated');
      const result = {
        json: data.json, jsonV2: data.jsonV2, masterPrompt: data.masterPrompt,
        prompts: data.prompts, selectedPrompt: data.selectedPrompt,
        selectedTemplateId: data.selectedTemplateId, sources: data.sources, generatedAt: data.generatedAt,
      };
      setFinalResult(result);
      setSelectedTemplateId(data.selectedTemplateId || 'brand-poster');
      setCompleteness(data.completeness || 1);
      pushMessage({ id: `complete-${Date.now()}`, role: 'bot', type: 'complete', answered: false });
      setPhase('template-select');
      setCurrentGap(null);
    } else {
      const remaining = data.remaining ?? 0;
      const pct = Math.round((data.completeness || 0) * 100);
      log('build', '[BUILD]', `${pct}% complete · ${remaining} gap${remaining === 1 ? '' : 's'} remaining`);
      setCompleteness(data.completeness || 0);
      if (data.nextGap) {
        log('active', '[CHAT]', data.nextGap.question, true);
        pushMessage({ id: `gap-${data.nextGap.id}`, role: 'bot', type: 'gap', gap: data.nextGap, answered: false });
        setCurrentGap(data.nextGap);
      }
    }

    setTextInput('');
    setSelectedFiles([]);
    setSubmitting(false);
  }, [currentGap, submitting, getIdToken, log, markAnswered, pushMessage]);

  const handleSkip = useCallback(() => submitAnswer({ skipped: true, value: null }), [submitAnswer]);

  // ── File handlers ──────────────────────────────────────────────────────────
  const handleSingleFile = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = await compressToLimit(String(reader.result || ''));
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) { log('error', '[ERR]', 'Could not read file.'); return; }
      submitAnswer({ value: file.name, imageBase64: match[2], mediaType: match[1], displayValue: `Uploaded ${file.name}`, imagePreview: dataUrl });
    };
    reader.readAsDataURL(file);
  }, [submitAnswer, log]);

  const handleMultiFileChange = useCallback((e) => {
    setSelectedFiles(Array.from(e.target.files || []));
  }, []);

  const submitMultiFiles = useCallback(() => {
    if (!selectedFiles.length) return;
    const total = selectedFiles.length;
    const imageList = [];
    let completed = 0;
    selectedFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = await compressToLimit(String(reader.result || ''));
        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) imageList.push({ imageBase64: match[2], mediaType: match[1] });
        completed++;
        if (completed === total) {
          submitAnswer({
            value: `${imageList.length} images uploaded`,
            images: imageList,
            displayValue: `Uploaded ${imageList.length} image${imageList.length === 1 ? '' : 's'}`,
            imagePreviews: imageList.slice(0, 4).map((img) => `data:${img.mediaType};base64,${img.imageBase64}`),
          });
        }
      };
      reader.readAsDataURL(file);
    });
  }, [selectedFiles, submitAnswer]);

  // ── Copy + Generate ────────────────────────────────────────────────────────
  const handleCopyPrompt = useCallback(() => {
    const prompt = finalResult?.prompts?.[selectedTemplateId] || finalResult?.masterPrompt || '';
    if (!prompt) return;
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [finalResult, selectedTemplateId]);

  const handleGenerateImage = useCallback(async () => {
    const prompt = finalResult?.prompts?.[selectedTemplateId] || finalResult?.masterPrompt || '';
    if (!prompt || generating) return;
    setGenerating(true);

    let token;
    try { token = await getIdToken(); }
    catch { log('error', '[ERR]', 'Could not get auth token.'); setGenerating(false); return; }

    log('build', '[IMAGE]', `Generating image with gpt-image-1 (${selectedTemplateId})…`);

    let res, data;
    try {
      res = await fetch('/api/brand-system/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt, templateId: selectedTemplateId }),
      });
      data = await res.json().catch(() => ({}));
    } catch (err) {
      log('error', '[ERR]', err?.message || 'Image generation failed.');
      setGenerating(false);
      return;
    }

    if (!res.ok || !data.b64) {
      log('error', '[ERR]', data?.error || `Generation failed (${res.status}).`);
      setGenerating(false);
      return;
    }

    log('ok', '[IMAGE]', `Image ready · ${data.size} · ${data.templateId}`);
    pushMessage({
      id: `gen-${Date.now()}`, role: 'bot', type: 'generated',
      b64: data.b64, mediaType: data.mediaType, size: data.size, templateId: data.templateId,
    });
    setGenerating(false);
  }, [finalResult, selectedTemplateId, generating, getIdToken, log, pushMessage]);

  // ── Gap input renderer (inside options-zone) ───────────────────────────────
  const renderGapInput = useCallback((gap) => {
    if (gap.type === 'image') {
      return (
        <div className="chat-text-wrap">
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"
            onChange={(e) => handleSingleFile(e.target.files?.[0])} style={{ display: 'none' }} />
          <div className="chat-text-actions">
            {!gap.required && (
              <button className="chat-skip-btn" type="button" onClick={handleSkip} disabled={submitting}>Skip</button>
            )}
            <button className="chat-confirm-btn" type="button" disabled={submitting}
              onClick={() => fileInputRef.current?.click()}>
              {submitting ? 'Analyzing…' : gap.id === 'logo' ? 'Upload logo →' : 'Upload image →'}
            </button>
          </div>
        </div>
      );
    }

    if (gap.type === 'image-multi') {
      return (
        <div className="chat-text-wrap">
          <input ref={multiFileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple
            onChange={handleMultiFileChange} style={{ display: 'none' }} />
          {selectedFiles.length > 0 && (
            <div className="chat-files-summary">
              {selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'} ready:{' '}
              {selectedFiles.map((f) => f.name).join(', ')}
            </div>
          )}
          <div className="chat-text-actions">
            {!gap.required && (
              <button className="chat-skip-btn" type="button" onClick={handleSkip} disabled={submitting}>Skip</button>
            )}
            <button className="chat-confirm-btn" type="button" disabled={submitting}
              onClick={() => multiFileRef.current?.click()}>
              {selectedFiles.length ? 'Choose different' : 'Choose images'}
            </button>
            {selectedFiles.length > 0 && (
              <button className="chat-confirm-btn" type="button" onClick={submitMultiFiles} disabled={submitting}>
                {submitting ? 'Analyzing…' : `Send ${selectedFiles.length} →`}
              </button>
            )}
          </div>
          <div className="chat-helper-inline">Up to {gap.maxFiles || 5} images. PNG, JPG, WebP.</div>
        </div>
      );
    }

    if (gap.type === 'choice') {
      return (
        <div className="chat-chips">
          {(gap.choices || []).map((choice) => (
            <button key={choice} type="button" className="chat-chip" disabled={submitting}
              onClick={() => submitAnswer({ value: choice, displayValue: choice })}>
              {choice}
            </button>
          ))}
          {!gap.required && (
            <button type="button" className="chat-chip" style={{ opacity: 0.5 }} disabled={submitting} onClick={handleSkip}>
              Skip
            </button>
          )}
        </div>
      );
    }

    if (gap.type === 'short-text-list') {
      const tokens = textInput
        .split(/\s*(?:[,/]|\band\b)\s*|\s{2,}/i)
        .map((s) => s.trim()).filter(Boolean).slice(0, 3);
      const ready = tokens.length === 3;
      return (
        <div className="chat-text-wrap">
          <textarea className="chat-text-input" rows={2} value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="raw / futuristic / grounded" disabled={submitting} />
          <div className="chat-helper-inline">
            {ready ? `Will send: ${tokens.join(' / ')}` : `Three words separated by commas or slashes. (${tokens.length}/3)`}
          </div>
          <div className="chat-text-actions">
            {!gap.required && (
              <button className="chat-skip-btn" type="button" onClick={handleSkip} disabled={submitting}>Skip</button>
            )}
            <button className="chat-confirm-btn" type="button" disabled={submitting || !ready}
              onClick={() => ready && submitAnswer({ value: tokens, displayValue: tokens.join(' / ') })}>
              Send →
            </button>
          </div>
        </div>
      );
    }

    // text (default)
    return (
      <div className="chat-text-wrap">
        <textarea className="chat-text-input" rows={3} value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          placeholder="Type your answer…" disabled={submitting} />
        <div className="chat-text-actions">
          {!gap.required && (
            <button className="chat-skip-btn" type="button" onClick={handleSkip} disabled={submitting}>Skip</button>
          )}
          <button className="chat-confirm-btn" type="button" disabled={submitting || !textInput.trim()}
            onClick={() => { const v = textInput.trim(); if (v) submitAnswer({ value: v, displayValue: v }); }}>
            Send →
          </button>
        </div>
      </div>
    );
  }, [
    textInput, selectedFiles, submitting,
    handleSingleFile, handleMultiFileChange, submitMultiFiles,
    submitAnswer, handleSkip,
  ]);

  // ── Template select options (inside options-zone of complete message) ───────
  const renderCompleteOptions = useCallback(() => {
    const preview = (finalResult?.prompts?.[selectedTemplateId] || finalResult?.masterPrompt || '')
      .split('\n').filter(Boolean).slice(0, 3).join('\n');
    return (
      <div id="bsc-complete-opts">
        <div id="bsc-template-grid">
          {TEMPLATE_OPTIONS.map(({ id, label, description }) => (
            <button key={id} type="button"
              className={`bsc-tcard${selectedTemplateId === id ? ' bsc-tcard--active' : ''}`}
              onClick={() => setSelectedTemplateId(id)}>
              <span className="bsc-tcard-label">{label}</span>
              <span className="bsc-tcard-desc">{description}</span>
            </button>
          ))}
        </div>
        {preview && (
          <div id="bsc-prompt-preview">
            <pre id="bsc-prompt-preview-text">{preview}…</pre>
          </div>
        )}
        <div className="chat-text-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', gap: '0.4rem' }}>
          <button className="chat-confirm-btn" type="button" disabled={generating} onClick={handleGenerateImage}>
            {generating ? 'Generating…' : 'Generate Image'}
          </button>
          <button className="chat-confirm-btn" type="button" onClick={handleCopyPrompt}>
            {copied ? 'Copied ✓' : 'Copy Prompt'}
          </button>
          <button className="chat-confirm-btn" type="button" onClick={() => onComplete?.(finalResult)}>
            Open Details ↗
          </button>
        </div>
        {generating && (
          <div className="chat-helper-inline" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
            Generating — 15–30 seconds…
          </div>
        )}
      </div>
    );
  }, [finalResult, selectedTemplateId, copied, generating, handleGenerateImage, handleCopyPrompt, onComplete]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div id="bsc-shell">

      {/* Header */}
      <div id="bsc-header">
        <div id="bsc-avatar-wrap">
          <img id="bsc-avatar-img" src="/img/profile2_400x400.png" alt="" aria-hidden="true" />
          <span id="bsc-online-dot" aria-hidden="true" />
        </div>
        <div id="bsc-identity">
          <span id="bsc-name">Brand System</span>
        </div>
        {totalGaps > 0 && (
          <span id="bsc-step-count" aria-live="polite">
            {String(answeredCount).padStart(2, '0')}&nbsp;/&nbsp;{String(totalGaps).padStart(2, '0')}
          </span>
        )}
      </div>

      {/* Progress rail */}
      <div id="bsc-progress-rail" aria-hidden="true">
        <span id="bsc-progress-fill" style={{ width: `${Math.round(completeness * 100)}%` }} />
      </div>

      {/* Messages */}
      <div id="bsc-messages" ref={scrollRef}>

        {/* Error state (no messages yet) */}
        {phase === 'error' && messages.length === 0 && (
          <div className="chat-turn">
            <div className="chat-row chat-row-bot">
              <img className="chat-avatar-sm" src="/img/profile2_400x400.png" alt="" aria-hidden="true" />
              <div className="chat-bubble chat-bubble-bot">
                <span className="chat-eyebrow">ERROR</span>
                <span className="chat-question" style={{ color: '#D71921', fontSize: '1rem' }}>Scan failed</span>
                <span className="chat-helper">{scanError}</span>
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => {
          // User bubble
          if (msg.role === 'user') {
            const hasSingleImg = Boolean(msg.imagePreview);
            const hasMultiImg  = Array.isArray(msg.imagePreviews) && msg.imagePreviews.length > 0;
            return (
              <div key={msg.id} className="chat-row chat-row-user">
                {msg.gapObject && !submitting && (
                  <button
                    type="button"
                    className="bsc-edit-btn"
                    aria-label={`Edit answer: ${msg.text}`}
                    onClick={() => handleEditAnswer(msg.gapId, msg.gapObject, msg.rawValue)}
                  >
                    Edit
                  </button>
                )}
                <div className="chat-bubble chat-bubble-user" style={(hasSingleImg || hasMultiImg) ? { padding: 0, overflow: 'hidden' } : undefined}>
                  {hasSingleImg && (
                    <img
                      src={msg.imagePreview}
                      alt="Uploaded"
                      style={{ display: 'block', width: '100%', maxHeight: '160px', objectFit: 'cover', objectPosition: 'top' }}
                    />
                  )}
                  {hasMultiImg && (
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(msg.imagePreviews.length, 2)}, 1fr)`, gap: '2px' }}>
                      {msg.imagePreviews.map((src, i) => (
                        <img key={i} src={src} alt={`Upload ${i + 1}`}
                          style={{ display: 'block', width: '100%', height: '80px', objectFit: 'cover', objectPosition: 'top' }} />
                      ))}
                    </div>
                  )}
                  <div style={(hasSingleImg || hasMultiImg) ? { padding: '0.45rem 0.7rem', fontSize: '0.78rem', opacity: 0.7 } : undefined}>
                    {msg.text}
                  </div>
                </div>
              </div>
            );
          }

          // Scan summary
          if (msg.type === 'scan-summary') {
            return (
              <div key={msg.id} className="chat-turn">
                <div className="chat-row chat-row-bot">
                  <img className="chat-avatar-sm" src="/img/profile2_400x400.png" alt="" aria-hidden="true" />
                  <div className="chat-bubble chat-bubble-bot">
                    <span className="chat-question">{msg.text}</span>
                  </div>
                </div>
              </div>
            );
          }

          // Gap question
          if (msg.type === 'gap') {
            const { gap, answered } = msg;
            return (
              <div key={msg.id} className="chat-turn">
                <div className="chat-row chat-row-bot">
                  <img className="chat-avatar-sm" src="/img/profile2_400x400.png" alt="" aria-hidden="true" />
                  <div className="chat-bubble chat-bubble-bot">
                    {gap.phase && (
                      <span className="chat-eyebrow">
                        {gap.phase === 1 ? 'SITE REVIEW' : gap.phase === 2 ? 'ASSETS' : 'BRAND DNA'}
                      </span>
                    )}
                    {gap.showsScreenshot && (gap.embeddedScreenshotUrl || homepageScreenshotUrl) && (
                      <div className="chat-header-image">
                        <img src={gap.embeddedScreenshotUrl || homepageScreenshotUrl} alt="Homepage screenshot" loading="lazy" />
                      </div>
                    )}
                    <span className="chat-question">{gap.question}</span>
                    {gap.hint && <span className="chat-helper">{gap.hint}</span>}
                  </div>
                </div>
                {!answered && (
                  <div className="chat-options-zone">{renderGapInput(gap)}</div>
                )}
              </div>
            );
          }

          // Complete — template selector
          if (msg.type === 'complete') {
            return (
              <div key={msg.id} className="chat-turn">
                <div className="chat-row chat-row-bot">
                  <img className="chat-avatar-sm" src="/img/profile2_400x400.png" alt="" aria-hidden="true" />
                  <div className="chat-bubble chat-bubble-bot">
                    <span className="chat-eyebrow">OUTPUT READY</span>
                    <span className="chat-question">Brand Guide assembled. Choose your output format:</span>
                  </div>
                </div>
                <div className="chat-options-zone">{renderCompleteOptions()}</div>
              </div>
            );
          }

          // Generated image
          if (msg.type === 'generated') {
            return (
              <div key={msg.id} className="chat-turn">
                <div className="chat-row chat-row-bot">
                  <img className="chat-avatar-sm" src="/img/profile2_400x400.png" alt="" aria-hidden="true" />
                  <div className="chat-bubble chat-bubble-bot" style={{ padding: 0, overflow: 'hidden', maxWidth: '90%' }}>
                    <img
                      src={`data:${msg.mediaType};base64,${msg.b64}`}
                      alt={`Generated — ${msg.templateId}`}
                      style={{ width: '100%', display: 'block', maxHeight: '280px', objectFit: 'contain', background: '#f5f3f0' }}
                    />
                    <div style={{ padding: '0.55rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.65rem', borderTop: '1px solid rgba(42,36,32,0.07)' }}>
                      <a href={`data:${msg.mediaType};base64,${msg.b64}`}
                        download={`brand-${msg.templateId}-${msg.size}.png`}
                        className="chat-confirm-btn" style={{ textDecoration: 'none', fontSize: '0.75rem' }}>
                        Download ↓
                      </a>
                      <span style={{ fontFamily: '"Space Mono", monospace', fontSize: '0.58rem', color: 'rgba(42,36,32,0.4)' }}>
                        {msg.size} · {msg.templateId}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          return null;
        })}

        {/* Typing indicator */}
        {typing && (
          <div className="chat-row chat-row-bot">
            <img className="chat-avatar-sm" src="/img/profile2_400x400.png" alt="" aria-hidden="true" />
            <div className="chat-bubble chat-bubble-bot chat-typing-bubble">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}

      </div>

      <style jsx>{`
        /* Shell — mirrors #onboarding-chat-shell */
        #bsc-shell {
          display: flex; flex-direction: column;
          width: 100%; min-height: 0; flex: 1 1 auto;
          background: linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.5) 100%);
          box-shadow: 0 5px 10px rgba(0,0,0,0.1), 0 15px 30px rgba(0,0,0,0.1), 0 20px 40px rgba(0,0,0,0.15);
          backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
          border-radius: 10px; border: 1px solid rgba(42,36,32,0.1); overflow: hidden;
        }

        /* Header — mirrors #onboarding-chat-header */
        #bsc-header {
          display: flex; align-items: center; gap: 0.65rem;
          padding: 0.75rem 1rem;
          border-bottom: 1px solid rgba(42,36,32,0.08);
          background: rgba(255,255,255,0.7); flex-shrink: 0;
        }
        #bsc-avatar-wrap { position: relative; flex-shrink: 0; }
        #bsc-avatar-img {
          width: 2.4rem; height: 2.4rem; border-radius: 999px;
          object-fit: cover; display: block;
        }
        #bsc-online-dot {
          position: absolute; bottom: 1px; right: 1px;
          width: 0.55rem; height: 0.55rem; border-radius: 999px;
          background: #4A9E5C; border: 2px solid rgba(255,252,248,0.92);
        }
        #bsc-identity { display: flex; flex-direction: column; gap: 0.15rem; flex: 1; min-width: 0; }
        #bsc-name {
          font-family: "Space Grotesk", system-ui, sans-serif;
          font-weight: 700; font-size: 0.88rem; color: #2a2420; line-height: 1.2;
        }
        #bsc-step-count {
          font-family: "Space Mono", monospace; font-size: 0.68rem;
          letter-spacing: 0.1em; color: rgba(42,36,32,0.44);
          flex-shrink: 0; white-space: nowrap;
        }

        /* Progress rail — mirrors #onboarding-chat-progress-rail */
        #bsc-progress-rail {
          height: 2px; background: rgba(42,36,32,0.08); flex-shrink: 0;
          position: relative; overflow: hidden;
        }
        #bsc-progress-fill {
          display: block; height: 100%;
          background: linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%);
          transition: width 0.35s ease;
        }

        /* Messages area — mirrors #onboarding-chat-messages */
        #bsc-messages {
          flex: 1 1 auto; min-height: 0; overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          padding: 1rem; display: flex; flex-direction: column; gap: 0.65rem;
          scrollbar-width: thin; scrollbar-color: rgba(42,36,32,0.14) transparent;
          overscroll-behavior: contain;
        }
        #bsc-messages::-webkit-scrollbar { width: 3px; }
        #bsc-messages::-webkit-scrollbar-thumb { background: rgba(42,36,32,0.14); border-radius: 2px; }
        #bsc-messages::-webkit-scrollbar-track { background: transparent; }

        /* Template selector */
        #bsc-complete-opts { display: flex; flex-direction: column; gap: 0.6rem; width: 100%; }
        #bsc-template-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem; }
        .bsc-tcard {
          background: rgba(255,255,255,0.7); border: 1px solid rgba(42,36,32,0.14);
          border-radius: 8px; padding: 0.5rem 0.65rem; text-align: left; cursor: pointer;
          display: flex; flex-direction: column; gap: 0.18rem; transition: border-color 0.12s;
        }
        .bsc-tcard:hover { border-color: rgba(42,36,32,0.4); }
        .bsc-tcard--active { border-color: #2a2420; background: rgba(42,36,32,0.05); }
        .bsc-tcard-label {
          font-family: "Space Grotesk", system-ui, sans-serif;
          font-size: 0.75rem; font-weight: 700; color: #2a2420;
        }
        .bsc-tcard-desc {
          font-family: "Space Grotesk", system-ui, sans-serif;
          font-size: 0.65rem; color: rgba(42,36,32,0.5); line-height: 1.35;
        }

        /* Edit answer button — sits left of user bubble */
        .bsc-edit-btn {
          align-self: flex-end;
          flex-shrink: 0;
          background: none;
          border: none;
          padding: 0 0.3rem 0.25rem;
          font-family: "Space Mono", monospace;
          font-size: 0.6rem;
          letter-spacing: 0.08em;
          color: rgba(42,36,32,0.32);
          cursor: pointer;
          transition: color 0.12s;
          line-height: 1;
          text-transform: uppercase;
        }
        .bsc-edit-btn:hover { color: rgba(42,36,32,0.72); }

        /* Prompt preview */
        #bsc-prompt-preview {
          background: rgba(42,36,32,0.03); border: 1px solid rgba(42,36,32,0.08);
          border-radius: 6px; padding: 0.55rem 0.7rem; overflow: hidden;
        }
        #bsc-prompt-preview-text {
          margin: 0; font-family: "Space Mono", monospace; font-size: 0.56rem;
          line-height: 1.6; color: rgba(42,36,32,0.45);
          white-space: pre-wrap; word-break: break-word;
          display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
        }
      `}</style>
    </div>
  );
}
