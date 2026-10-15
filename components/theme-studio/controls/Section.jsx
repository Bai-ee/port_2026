'use client';

import React from 'react';
import Icon from '../Icon.jsx';
import { useStudio } from '../StudioContext.jsx';

/** Accordion section. Closed sections render nothing, so only open ones cost render time. */
export default function Section({ id, num, title, summary, children }) {
  const { ui, dispatch } = useStudio();
  const open = !!ui.openSections[id];
  const panelId = `theme-studio-section-${id}-panel`;
  return (
    <section className="ts-section" id={`theme-studio-section-${id}`} data-section={id}>
      <h3 style={{ margin: 0 }}>
        <button
          type="button"
          className="ts-section-head"
          id={`theme-studio-section-${id}-header`}
          aria-expanded={open ? 'true' : 'false'}
          aria-controls={panelId}
          onClick={() => dispatch({ type: 'section/toggle', id })}
        >
          <span className="ts-section-num" aria-hidden="true">{num}</span>
          <span className="ts-section-title">{title}</span>
          {summary ? <span className="ts-section-sum">{summary}</span> : null}
          <Icon name="chevron" className="ts-chev" />
        </button>
      </h3>
      {open ? (
        <div className="ts-section-panel" id={panelId} role="region" aria-labelledby={`theme-studio-section-${id}-header`}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
