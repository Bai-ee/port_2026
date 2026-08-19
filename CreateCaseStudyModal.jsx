import React, { useEffect, useState } from 'react';
import Image from 'next/image';

const CASE_STUDY_TAGS = ['Design', 'Websites', 'Content', 'Video', 'AI Workflows', 'Blockchain'];

const glassPanelStyle = {
  background: '#ffffff',
  boxShadow: '0 32px 90px rgba(42,36,32,0.18)',
  borderRadius: '1.5rem',
};

const CreateCaseStudyModal = ({ image, onClose }) => {
  const [tag, setTag] = useState(null);

  useEffect(() => {
    if (!image) return undefined;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    document.body.style.overflow = 'hidden';
    window.__lenis?.stop();
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.__lenis?.start();
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [image, onClose]);

  useEffect(() => {
    if (!image) setTag(null);
  }, [image]);

  if (!image) return null;

  return (
    <div id="create-case-study-modal-overlay" style={overlayStyle} onClick={onClose}>
      <div id="create-case-study-modal-shell" style={{ ...modalStyle, ...glassPanelStyle }} onClick={(event) => event.stopPropagation()}>
        <div style={modalTopStyle}>
          <div>
            <span style={modalEyebrowStyle}>New Case Study</span>
            <h2 style={modalTitleStyle}>Create Case Study</h2>
            <p style={modalSummaryStyle}>Draft the write-up for this project. Nothing here saves yet — placeholder fields only.</p>
          </div>
          <button type="button" onClick={onClose} style={closeButtonStyle} aria-label="Close">
            Close
          </button>
        </div>

        <div id="case-study-form-fields" style={modalBodyStyle}>
          <div id="case-study-cover-preview" style={coverPreviewStyle}>
            <Image src={image} alt="" fill sizes="(max-width: 768px) 100vw, 640px" style={{ objectFit: 'cover' }} />
          </div>

          <label style={fieldLabelStyle} htmlFor="case-study-title-input">Project Title</label>
          <input id="case-study-title-input" type="text" placeholder="e.g. Fintech Dashboard Redesign" style={inputStyle} />

          <label style={fieldLabelStyle} htmlFor="case-study-client-input">Client / Company</label>
          <input id="case-study-client-input" type="text" placeholder="e.g. Acme Studio" style={inputStyle} />

          <label style={fieldLabelStyle}>Category</label>
          <div id="case-study-tag-chips-row" style={tagChipsRowStyle}>
            {CASE_STUDY_TAGS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTag(item)}
                style={{ ...tagChipStyle, ...(item === tag ? activeTagChipStyle : null) }}
              >
                {item}
              </button>
            ))}
          </div>

          <label style={fieldLabelStyle} htmlFor="case-study-summary-input">Summary</label>
          <textarea id="case-study-summary-input" placeholder="What was the project, and what problem did it solve?" rows={3} style={textareaStyle} />

          <label style={fieldLabelStyle} htmlFor="case-study-outcome-input">Outcome / Results</label>
          <textarea id="case-study-outcome-input" placeholder="What changed for the client after launch?" rows={3} style={textareaStyle} />
        </div>

        <div id="case-study-modal-footer" style={modalFooterStyle}>
          <span style={placeholderNoteStyle}>Placeholder only — case study creation isn&apos;t wired up yet.</span>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="button" onClick={onClose} style={secondaryButtonStyle}>Cancel</button>
            <button type="button" disabled style={{ ...primaryButtonStyle, opacity: 0.5, cursor: 'not-allowed' }}>Save Case Study</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 330,
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'clamp(1rem, 3vw, 2rem)',
  boxSizing: 'border-box',
};

const modalStyle = {
  width: 'min(640px, 100%)',
  maxHeight: 'min(88dvh, 900px)',
  color: '#2a2420',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const modalTopStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '1.5rem',
  padding: 'clamp(1.25rem, 2.5vw, 2rem)',
  borderBottom: '1px solid rgba(42, 36, 32, 0.1)',
};

const modalEyebrowStyle = {
  display: 'block',
  fontStyle: 'italic',
  fontSize: 'clamp(0.8rem, 1.1vw, 0.95rem)',
  color: 'rgba(42, 36, 32, 0.5)',
  marginBottom: '0.45rem',
};

const modalTitleStyle = {
  margin: 0,
  fontSize: 'clamp(1.5rem, 2.6vw, 2.2rem)',
  lineHeight: 1,
  letterSpacing: '-0.04em',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const modalSummaryStyle = {
  margin: '0.75rem 0 0',
  maxWidth: '42ch',
  fontSize: 'clamp(0.85rem, 1.1vw, 0.94rem)',
  lineHeight: 1.6,
  color: 'rgba(42, 36, 32, 0.7)',
};

const closeButtonStyle = {
  border: '1px solid rgba(42, 36, 32, 0.12)',
  background: 'rgba(255,255,255,0.42)',
  color: '#2a2420',
  borderRadius: '999px',
  padding: '0.7rem 1rem',
  fontSize: '0.78rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  alignSelf: 'flex-start',
  flexShrink: 0,
};

const modalBodyStyle = {
  overflowY: 'auto',
  padding: 'clamp(1.25rem, 2.5vw, 2rem)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
};

const coverPreviewStyle = {
  position: 'relative',
  width: '100%',
  height: 'clamp(140px, 24vw, 220px)',
  flexShrink: 0,
  borderRadius: '0.85rem',
  overflow: 'hidden',
  border: '1px solid rgba(42, 36, 32, 0.1)',
  marginBottom: '0.6rem',
};

const fieldLabelStyle = {
  fontSize: '0.72rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'rgba(42, 36, 32, 0.48)',
  marginTop: '0.5rem',
};

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  borderRadius: '0.75rem',
  border: '1px solid rgba(42, 36, 32, 0.12)',
  background: 'rgba(255,255,255,0.5)',
  color: '#2a2420',
  padding: '0.75rem 0.9rem',
  fontSize: '0.92rem',
  fontFamily: 'inherit',
};

const textareaStyle = {
  ...inputStyle,
  resize: 'vertical',
  lineHeight: 1.5,
};

const tagChipsRowStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
};

const tagChipStyle = {
  border: '1px solid rgba(42, 36, 32, 0.12)',
  background: 'rgba(255,255,255,0.32)',
  color: 'rgba(42, 36, 32, 0.72)',
  borderRadius: '999px',
  padding: '0.5rem 0.85rem',
  fontSize: '0.75rem',
  fontWeight: 700,
  letterSpacing: '0.03em',
  cursor: 'pointer',
};

const activeTagChipStyle = {
  background: '#2a2420',
  color: '#f5f1df',
  borderColor: '#2a2420',
};

const modalFooterStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1rem',
  padding: 'clamp(1.25rem, 2.5vw, 2rem)',
  borderTop: '1px solid rgba(42, 36, 32, 0.1)',
  flexWrap: 'wrap',
};

const placeholderNoteStyle = {
  fontSize: '0.75rem',
  color: 'rgba(42, 36, 32, 0.45)',
  fontStyle: 'italic',
};

const primaryButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.5rem',
  border: 'none',
  background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
  color: '#ffffff',
  borderRadius: '999px',
  padding: '0.75rem 1.1rem',
  fontSize: '0.85rem',
  fontWeight: 700,
  letterSpacing: '0.01em',
  whiteSpace: 'nowrap',
};

const secondaryButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid rgba(42, 36, 32, 0.12)',
  background: 'rgba(255,255,255,0.28)',
  color: '#2a2420',
  borderRadius: '999px',
  padding: '0.75rem 1rem',
  fontSize: '0.78rem',
  fontWeight: 700,
  letterSpacing: '0.04em',
  cursor: 'pointer',
};

export default CreateCaseStudyModal;
