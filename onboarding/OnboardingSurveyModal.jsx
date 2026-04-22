'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Onboarding survey — overlay modal that layers above the intake-build modal
 * while the dashboard is provisioning. Steps come from onboarding/questions.config.cjs.
 *
 * For Phase 2 this component is mounted with a single step (stage). Navigation
 * logic is wired as if multi-step so Phase 3 can pass the full step array
 * without code changes here.
 *
 * Props:
 *   steps: array of step objects (from QUESTION_STEPS)
 *   initialAnswers: { [stepId]: { value, skipped } } seed from GET
 *   onAnswer(stepId, value): submit a single-step answer (awaited)
 *   onSkipStep(stepId): mark step skipped (awaited)
 *   onSkipAll(): mark whole survey skipped (awaited, then onResolved fires)
 *   onComplete(): mark whole survey complete (awaited, then onResolved fires)
 *   onResolved(): called after skipAll or complete succeeds
 */
export default function OnboardingSurveyModal({
  steps,
  initialAnswers = {},
  onAnswer,
  onSkipStep,
  onSkipAll,
  onComplete,
  onResolved,
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [localValues, setLocalValues] = useState(() => {
    const seed = {};
    for (const step of steps) {
      const existing = initialAnswers?.[step.id];
      if (existing && !existing.skipped && existing.value !== undefined && existing.value !== null) {
        seed[step.id] = existing.value;
      } else {
        seed[step.id] = step.selectType === 'multi' ? [] : step.selectType === 'text' ? '' : null;
      }
    }
    return seed;
  });
  const [busy, setBusy] = useState(false);

  const step = steps[stepIndex];
  const stepCount = steps.length;
  const currentValue = localValues[step.id];
  const hasValue = useMemo(() => {
    if (step.selectType === 'single') return typeof currentValue === 'string' && currentValue.length > 0;
    if (step.selectType === 'multi') return Array.isArray(currentValue) && currentValue.length > 0;
    if (step.selectType === 'text') return typeof currentValue === 'string' && currentValue.trim().length > 0;
    return false;
  }, [step.selectType, currentValue]);

  const isLastStep = stepIndex === stepCount - 1;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const setValue = useCallback((nextValue) => {
    setLocalValues((prev) => ({ ...prev, [step.id]: nextValue }));
  }, [step.id]);

  const toggleMulti = useCallback((optionValue) => {
    setLocalValues((prev) => {
      const current = Array.isArray(prev[step.id]) ? prev[step.id] : [];
      const next = current.includes(optionValue)
        ? current.filter((v) => v !== optionValue)
        : [...current, optionValue];
      return { ...prev, [step.id]: next };
    });
  }, [step.id]);

  const handleNext = useCallback(async () => {
    if (busy) return;
    if (!hasValue) return;
    setBusy(true);
    try {
      await onAnswer(step.id, currentValue);
      if (isLastStep) {
        await onComplete();
        onResolved?.();
      } else {
        setStepIndex((i) => i + 1);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, hasValue, currentValue, step.id, isLastStep, onAnswer, onComplete, onResolved]);

  const handleSkipStep = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSkipStep(step.id);
      if (isLastStep) {
        await onComplete();
        onResolved?.();
      } else {
        setStepIndex((i) => i + 1);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, step.id, isLastStep, onSkipStep, onComplete, onResolved]);

  const handleBack = useCallback(() => {
    if (busy || stepIndex === 0) return;
    setStepIndex((i) => i - 1);
  }, [busy, stepIndex]);

  const handleSkipAll = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSkipAll();
      onResolved?.();
    } finally {
      setBusy(false);
    }
  }, [busy, onSkipAll, onResolved]);

  return (
    <section
      id="onboarding-survey-card"
      role="region"
      aria-label="Onboarding questions"
    >

        {/* ── Top bar (step eyebrow + progress + skip-all) ── */}
        <div id="onboarding-step-header">
          <span id="onboarding-step-eyebrow">{step.eyebrow}</span>
          <span id="onboarding-step-progress">
            {String(stepIndex + 1).padStart(2, '0')} / {String(stepCount).padStart(2, '0')}
          </span>
          <button
            id="onboarding-step-close"
            type="button"
            onClick={handleSkipAll}
            disabled={busy}
            aria-label="Skip onboarding and continue"
          >✕</button>
        </div>

        {/* ── Progress rail ── */}
        <div id="onboarding-progress-rail" aria-hidden="true">
          <span
            id="onboarding-progress-fill"
            style={{ width: `${((stepIndex + 1) / stepCount) * 100}%` }}
          />
        </div>

        {/* ── Title ── */}
        <h2 id="onboarding-step-title">{step.title}</h2>
        {step.helper ? <p id="onboarding-step-helper">{step.helper}</p> : null}

        {/* ── Options ── */}
        <div id="onboarding-step-options" data-select-type={step.selectType}>
          {step.selectType === 'text' ? (
            <textarea
              id="onboarding-step-textarea"
              value={currentValue || ''}
              maxLength={step.maxLength || 500}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Type here…"
              rows={4}
            />
          ) : (
            step.options.map((opt) => {
              const selected = step.selectType === 'multi'
                ? Array.isArray(currentValue) && currentValue.includes(opt.value)
                : currentValue === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={`onboarding-option-tile${selected ? ' is-selected' : ''}`}
                  onClick={() => {
                    if (step.selectType === 'multi') toggleMulti(opt.value);
                    else setValue(opt.value);
                  }}
                >
                  <span className="onboarding-option-label">{opt.label}</span>
                </button>
              );
            })
          )}
        </div>

        {/* ── Footer ── */}
        <div id="onboarding-step-footer">
          <button
            id="onboarding-skip-all"
            type="button"
            onClick={handleSkipAll}
            disabled={busy}
          ></button>

          <div id="onboarding-step-footer-right">
            <button
              id="onboarding-back"
              type="button"
              onClick={handleBack}
              disabled={busy || stepIndex === 0}
            >Back</button>
            <button
              id="onboarding-next"
              type="button"
              onClick={hasValue ? handleNext : handleSkipStep}
              disabled={busy}
            >
              {hasValue ? (isLastStep ? 'Finish' : 'Next →') : 'Skip →'}
            </button>
          </div>
        </div>

    </section>
  );
}
