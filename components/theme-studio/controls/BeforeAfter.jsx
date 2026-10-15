'use client';

import React from 'react';
import ModeSwitch from './ModeSwitch.jsx';

/** Compare the draft with the published theme on the live page. */
export default function BeforeAfter({ value, onChange, differs }) {
  return (
    <div className="ts-field">
      <span className="ts-label" id="theme-studio-compare-label">Before and after</span>
      <ModeSwitch
        id="theme-studio-compare-switch"
        label="Show on this page"
        value={value}
        onChange={onChange}
        block
        options={[
          { value: 'draft', label: 'Your draft' },
          { value: 'production', label: 'Published theme' },
        ]}
      />
      <p className="ts-hint">
        {value === 'production'
          ? 'The page shows the published theme. Editing returns to your draft.'
          : differs
            ? 'Switch to Published theme to see what visitors see today.'
            : 'Your draft matches the published theme, so there is nothing to compare yet.'}
      </p>
    </div>
  );
}
