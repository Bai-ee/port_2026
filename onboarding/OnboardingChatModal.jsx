'use client';

import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';

/**
 * Conversational replacement for OnboardingSurveyModal.
 * Same prop contract — drop-in swap.
 *
 * Props:
 *   steps, initialAnswers, onAnswer, onSkipStep, onSkipAll, onComplete, onResolved
 */
export default function OnboardingChatModal({
  steps,
  initialAnswers = {},
  onAnswer,
  onSkipStep,
  onSkipAll,
  onComplete,
  onResolved,
}) {
  const [messages, setMessages] = useState([]);
  const [introMode, setIntroMode] = useState(true);
  const [activeStep, setActiveStep] = useState(0);
  const [pendingMulti, setPendingMulti] = useState([]);
  const [textValue, setTextValue] = useState('');
  const [typing, setTyping] = useState(true);
  const [busy, setBusy] = useState(false);

  const scrollRef = useRef(null);
  const step = steps[activeStep];
  const isLastStep = activeStep === steps.length - 1;

  // Intro: show typing indicator on mount, then reveal intro message
  useEffect(() => {
    const t = setTimeout(() => {
      setTyping(false);
      setMessages([{ id: 'intro', role: 'bot', type: 'intro', answered: false }]);
    }, 900);
    return () => clearTimeout(t);
  }, []);

  // Auto-scroll on new messages or typing indicator
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  const markAnswered = useCallback((idx) => {
    setMessages((prev) =>
      prev.map((m) => (m.role === 'bot' && m.stepIndex === idx ? { ...m, answered: true } : m))
    );
  }, []);

  const pushUser = useCallback((text) => {
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: 'user', text },
    ]);
  }, []);

  const pushBot = useCallback((idx) => {
    setMessages((prev) => [
      ...prev,
      { id: `bot-${idx}`, role: 'bot', stepIndex: idx, answered: false },
    ]);
  }, []);

  const advance = useCallback(
    async (value, label) => {
      if (busy) return;
      setBusy(true);
      markAnswered(activeStep);
      pushUser(label);
      try {
        await onAnswer(step.id, value);
        if (isLastStep) {
          await onComplete();
          onResolved?.();
        } else {
          setTyping(true);
          await new Promise((r) => setTimeout(r, 520));
          setTyping(false);
          const next = activeStep + 1;
          setActiveStep(next);
          pushBot(next);
          setPendingMulti([]);
          setTextValue('');
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, activeStep, isLastStep, step, markAnswered, pushUser, pushBot, onAnswer, onComplete, onResolved]
  );

  const handleSkipStep = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    markAnswered(activeStep);
    pushUser('—');
    try {
      await onSkipStep(step.id);
      if (isLastStep) {
        await onComplete();
        onResolved?.();
      } else {
        setTyping(true);
        await new Promise((r) => setTimeout(r, 520));
        setTyping(false);
        const next = activeStep + 1;
        setActiveStep(next);
        pushBot(next);
        setPendingMulti([]);
        setTextValue('');
      }
    } finally {
      setBusy(false);
    }
  }, [busy, activeStep, isLastStep, step, markAnswered, pushUser, pushBot, onSkipStep, onComplete, onResolved]);

  const handleIntroAccept = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setMessages((prev) => prev.map((m) => m.id === 'intro' ? { ...m, answered: true } : m));
    pushUser('Answer questions');
    setTyping(true);
    await new Promise((r) => setTimeout(r, 600));
    setTyping(false);
    setIntroMode(false);
    pushBot(0);
    setBusy(false);
  }, [busy, pushUser, pushBot]);

  const handleSkipAll = useCallback(async (label = 'Skip for now') => {
    if (busy) return;
    setBusy(true);
    setMessages((prev) => prev.map((m) => m.id === 'intro' ? { ...m, answered: true } : m));
    pushUser(label);
    setTyping(true);
    await new Promise((r) => setTimeout(r, 600));
    setTyping(false);
    setMessages((prev) => [
      ...prev,
      { id: 'skip-response', role: 'bot', type: 'skip-response' },
    ]);
    await new Promise((r) => setTimeout(r, 1200));
    try {
      await onSkipAll();
      onResolved?.();
    } finally {
      setBusy(false);
    }
  }, [busy, pushUser, onSkipAll, onResolved]);

  return (
    <div id="onboarding-chat-shell">

      {/* ── Header ── */}
      <div id="onboarding-chat-header">
        <div id="onboarding-chat-avatar-wrap">
          <img id="onboarding-chat-avatar-img" src="/img/profile_400x400.jpg" alt="Bryan Balli" />
          <span id="onboarding-chat-online-dot" aria-hidden="true" />
        </div>
        <div id="onboarding-chat-identity">
          <span id="onboarding-chat-name">Bryan Balli</span>
          {/* <span id="onboarding-chat-subtitle">Human + AI&nbsp;&nbsp;·&nbsp;&nbsp;Usually replies fast</span> */}
        </div>
        {!introMode && (
          <span id="onboarding-chat-step-count" aria-live="polite">
            {String(activeStep + 1).padStart(2, '0')}&nbsp;/&nbsp;{String(steps.length).padStart(2, '0')}
          </span>
        )}
        {/* <button
          id="onboarding-chat-close"
          type="button"
          onClick={handleSkipAll}
          disabled={busy}
          aria-label="Skip onboarding"
        >✕</button> */}
      </div>

      {/* ── Progress rail ── */}
      <div id="onboarding-chat-progress-rail" aria-hidden="true">
        <span
          id="onboarding-chat-progress-fill"
          style={{ width: introMode ? '0%' : `${((activeStep + 1) / steps.length) * 100}%` }}
        />
      </div>

      {/* ── Messages ── */}
      <div id="onboarding-chat-messages" ref={scrollRef}>

        {messages.map((msg) => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="chat-row chat-row-user">
                <div className="chat-bubble chat-bubble-user">{msg.text}</div>
              </div>
            );
          }

          // ── Skip response ──
          if (msg.type === 'skip-response') {
            return (
              <div key={msg.id} className="chat-turn chat-msg-in">
                <div className="chat-row chat-row-bot">
                  <img className="chat-avatar-sm" src="/img/profile_400x400.jpg" alt="" aria-hidden="true" />
                  <div className="chat-bubble chat-bubble-bot">
                    <span className="chat-question">No problem, you can return to answer questions later on if you like.</span>
                  </div>
                </div>
              </div>
            );
          }

          // ── Intro message ──
          if (msg.type === 'intro') {
            return (
              <div key={msg.id} className="chat-turn">
                <div className="chat-row chat-row-bot">
                  <img className="chat-avatar-sm" src="/img/profile_400x400.jpg" alt="" aria-hidden="true" />
                  <div className="chat-bubble chat-bubble-bot">
                    <span className="chat-question">Answer a few simple questions to add context and improve your onboarding experience.</span>
                  </div>
                </div>
                {!msg.answered && (
                  <div className="chat-options-zone">
                    <div className="chat-chips">
                      <button className="chat-chip chat-chip-primary" type="button" onClick={handleIntroAccept} disabled={busy}>
                        Answer questions
                      </button>
                      <button className="chat-chip" type="button" onClick={() => handleSkipAll('Skip for now')} disabled={busy}>
                        Skip for now
                      </button>
                      <button className="chat-chip" type="button" onClick={() => handleSkipAll('Answer later')} disabled={busy}>
                        Answer later
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          }

          const s = steps[msg.stepIndex];
          if (!s) return null;
          const isActive = !msg.answered && msg.stepIndex === activeStep;

          return (
            <div key={msg.id} className="chat-turn">
              {/* Bot message bubble */}
              <div className="chat-row chat-row-bot">
                <img className="chat-avatar-sm" src="/img/profile_400x400.jpg" alt="" aria-hidden="true" />
                <div className="chat-bubble chat-bubble-bot">
                  {s.eyebrow && <span className="chat-eyebrow">{s.eyebrow}</span>}
                  <span className="chat-question">{s.title}</span>
                  {s.helper && <span className="chat-helper">{s.helper}</span>}
                </div>
              </div>

              {/* Options — only for the active (unanswered) step */}
              {isActive && (
                <div className="chat-options-zone">
                  {s.selectType === 'text' ? (
                    <div className="chat-text-wrap">
                      <textarea
                        className="chat-text-input"
                        value={textValue}
                        maxLength={s.maxLength || 500}
                        onChange={(e) => setTextValue(e.target.value)}
                        placeholder="Type your answer…"
                        rows={3}
                        disabled={busy}
                      />
                      <div className="chat-text-actions">
                        <button className="chat-skip-btn" type="button" onClick={handleSkipStep} disabled={busy}>
                          Skip
                        </button>
                        <button
                          className="chat-confirm-btn"
                          type="button"
                          onClick={() => textValue.trim() && advance(textValue.trim(), textValue.trim())}
                          disabled={busy || !textValue.trim()}
                        >
                          Send →
                        </button>
                      </div>
                    </div>
                  ) : s.selectType === 'multi' ? (
                    <>
                      <div className="chat-chips">
                        {s.options.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            className={`chat-chip${pendingMulti.includes(opt.value) ? ' is-selected' : ''}`}
                            onClick={() =>
                              setPendingMulti((prev) =>
                                prev.includes(opt.value)
                                  ? prev.filter((v) => v !== opt.value)
                                  : [...prev, opt.value]
                              )
                            }
                            disabled={busy}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <div className="chat-text-actions">
                        <button className="chat-skip-btn" type="button" onClick={handleSkipStep} disabled={busy}>
                          Skip
                        </button>
                        {pendingMulti.length > 0 && (
                          <button
                            className="chat-confirm-btn"
                            type="button"
                            onClick={() => {
                              const labels = pendingMulti
                                .map((v) => s.options.find((o) => o.value === v)?.label)
                                .filter(Boolean)
                                .join(', ');
                              advance(pendingMulti, labels);
                            }}
                            disabled={busy}
                          >
                            Confirm →
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    /* single */
                    <div className="chat-chips">
                      {s.options.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className="chat-chip"
                          onClick={() => advance(opt.value, opt.label)}
                          disabled={busy}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Typing indicator */}
        {typing && (
          <div className="chat-row chat-row-bot">
            <img className="chat-avatar-sm" src="/img/profile_400x400.jpg" alt="" aria-hidden="true" />
            <div className="chat-bubble chat-bubble-bot chat-typing-bubble">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}

      </div>

      {/* ── Footer — persistent Skip All for mid-survey exit ── */}
      {!introMode && (
        <div id="onboarding-chat-footer">
          <button id="onboarding-chat-skip-all" type="button" onClick={() => handleSkipAll('Skip remaining')} disabled={busy}>
            Skip remaining questions
          </button>
        </div>
      )}

    </div>
  );
}
